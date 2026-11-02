"""Exercise the actual Lambda packager without third-party dependencies."""

import importlib.util
import io
import json
import shutil
import tempfile
import unittest
import zipfile
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parents[2] / "services/diet-f6"
spec = importlib.util.spec_from_file_location("diet_packager", HERE / "build.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class LambdaPackageTest(unittest.TestCase):
    def fixture(self, root):
        source = root / "services/diet-f6"
        for folder in ("f6_diet", "data", "prompts"):
            shutil.copytree(SOURCE / folder, source / folder, ignore=shutil.ignore_patterns("__pycache__"))
        cache = root / ".cache/diet-f6"
        (cache / "lambda-package").mkdir(parents=True)
        (cache / "lambda-pip-report.json").write_text('{"install": []}', encoding="utf-8")
        return source, cache

    def run_build(self, root):
        with patch.object(builder, "__file__", str(root / "infra/aws/diet/build.py")):
            with redirect_stdout(io.StringIO()):
                builder.main()

    def test_archive_loads_official_and_legacy_catalogs_and_excludes_unlisted_files(self):
        with tempfile.TemporaryDirectory(prefix="rexrun-diet-package-") as temporary:
            root = Path(temporary)
            source, cache = self.fixture(root)
            (source / "data/unlisted.json").write_text("{}", encoding="utf-8")
            (source / "f6_diet/.env").write_text("test fixture only", encoding="utf-8")
            self.run_build(root)
            with zipfile.ZipFile(cache / "lambda.zip") as archive:
                self.assertNotIn("data/unlisted.json", archive.namelist())
                self.assertNotIn("f6_diet/.env", archive.namelist())
                self.assertEqual(archive.read("data/catalog-source.json"), (source / "data/catalog-source.json").read_bytes())
                for name in ("f6_diet/catalog.py", "data/catalog-source.json", "data/food_aliases.csv", "data/food_nutrition_mfds.csv", "data/food_nutrition_dev_sample.csv"):
                    target = root / "extracted" / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(archive.read(name))
            module_spec = importlib.util.spec_from_file_location("packaged_catalog", root / "extracted/f6_diet/catalog.py")
            module = importlib.util.module_from_spec(module_spec)
            module_spec.loader.exec_module(module)
            official = module.Catalog(root / "extracted/data")
            self.assertGreater(len(official.foods), 10000)
            self.assertEqual(official.version, json.loads((source / "data/catalog-source.json").read_text(encoding="utf-8"))["version"])
            legacy = module.Catalog(root / "extracted/data", prefer_official=False)
            self.assertEqual(legacy.version, "f6-dev-sample-v1")
            self.assertIn("DEV-0001", legacy.by_code)

    def test_missing_metadata_stops_build_even_if_an_old_cache_has_a_copy(self):
        with tempfile.TemporaryDirectory(prefix="rexrun-diet-package-") as temporary:
            root = Path(temporary)
            source, cache = self.fixture(root)
            cached = cache / "lambda-package/data"
            cached.mkdir()
            shutil.copyfile(source / "data/catalog-source.json", cached / "catalog-source.json")
            (source / "data/catalog-source.json").unlink()
            with self.assertRaisesRegex(FileNotFoundError, "metadata is required"):
                self.run_build(root)
            self.assertFalse((cache / "lambda.zip").exists())
