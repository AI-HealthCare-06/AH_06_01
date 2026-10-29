package com.rexrun.demo;

import android.Manifest;
import android.app.Dialog;
import android.graphics.*;
import android.graphics.drawable.ColorDrawable;
import android.os.SystemClock;
import android.util.Size;
import android.view.*;
import android.widget.*;

import androidx.camera.core.*;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import androidx.lifecycle.LifecycleOwner;

import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import com.google.mediapipe.framework.image.BitmapImageBuilder;
import com.google.mediapipe.framework.image.MPImage;
import com.google.mediapipe.tasks.components.containers.*;
import com.google.mediapipe.tasks.core.BaseOptions;
import com.google.mediapipe.tasks.core.Delegate;
import com.google.mediapipe.tasks.vision.core.RunningMode;
import com.google.mediapipe.tasks.vision.facelandmarker.*;
import com.google.mediapipe.tasks.vision.handlandmarker.*;
import com.google.mediapipe.tasks.vision.objectdetector.*;

import org.json.JSONObject;

import java.io.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;

/** CameraX owns camera frames; no JPEG/base64/ImageBitmap crosses the WebView bridge. */
@CapacitorPlugin(
        name = "MotionVision",
        permissions = {
            @Permission(
                    alias = "camera",
                    strings = {Manifest.permission.CAMERA})
        })
public class MotionVisionPlugin extends Plugin {
    private final ExecutorService analyzer = Executors.newSingleThreadExecutor();
    private volatile String session;
    private volatile String pending;
    private ProcessCameraProvider camera;
    private ImageAnalysis analysis;
    private Dialog dialog;
    private TextView status;
    private ProgressBar hold;
    private PreviewView preview;
    private TargetOverlay overlay;
    private FaceLandmarker face;
    private HandLandmarker hands;
    private ObjectDetector objects;
    private ObjectDetector tools;
    private ObjectDetectorResult lastTools;
    private long toolsAt = -10000;
    private int previousWidth = 0, previousHeight = 0;
    private FaceLandmarkerResult lastFace;
    private ObjectDetectorResult lastObjects;
    private long faceAt = -10000, objectsAt = -10000;
    private MotionFrameGate gate;
    private String delegates = "";
    private boolean injection;
    private final String assets = "public/models/motion-capture/";

    @PluginMethod
    public void start(PluginCall call) {
        String id = call.getString("sessionId", "");
        if (id.length() < 8 || id.length() > 100 || analyzer.isShutdown()) {
            call.reject("Invalid camera session");
            return;
        }
        pending = id;
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            requestPermissionForAlias("camera", call, "cameraPermission");
            return;
        }
        startAuthorized(call);
    }

    @PermissionCallback
    private void cameraPermission(PluginCall call) {
        if (getPermissionState("camera") == PermissionState.GRANTED) startAuthorized(call);
        else call.reject("카메라 권한이 필요해요.", "CAMERA_PERMISSION");
    }

    private void startAuthorized(PluginCall call) {
        String id = call.getString("sessionId", "");
        if (!id.equals(pending)) {
            call.reject("Session closed");
            return;
        }
        getActivity()
                .runOnUiThread(
                        () -> {
                            if (!id.equals(pending) || analyzer.isShutdown()) {
                                call.reject("Session closed");
                                return;
                            }
                            stopSession(false);
                            pending = null;
                            session = id;
                            boolean inject = call.getBoolean("injection", false);
                            boolean gpu = !"cpu".equals(call.getString("delegate", "auto"));
                            analyzer.execute(() -> initializeModels(id, inject, gpu, call));
                        });
    }

    private <T> T withDelegate(
            String name, boolean gpu, java.util.function.Function<Delegate, T> factory) {
        if (gpu) {
            try {
                T model = factory.apply(Delegate.GPU);
                delegates += name + ":GPU ";
                return model;
            } catch (RuntimeException ignored) {
            }
        }
        T model = factory.apply(Delegate.CPU);
        delegates += name + (gpu ? ":CPU-fallback " : ":CPU ");
        return model;
    }

    private void initializeModels(String id, boolean inject, boolean gpu, PluginCall call) {
        try {
            if (!id.equals(session)) {
                call.reject("Session closed");
                return;
            }
            injection = inject;
            gate = new MotionFrameGate();
            faceAt = objectsAt = toolsAt = -10000;
            previousWidth = previousHeight = 0;
            lastFace = null;
            lastObjects = null;
            lastTools = null;
            delegates = "";
            if (!inject) face = withDelegate("face", gpu, this::createFace);
            hands = withDelegate("hand", gpu, this::createHands);
            if (!inject) objects = withDelegate("object", gpu, this::createObjects);
            String toolFile = validatedToolFile();
            if (toolFile != null) tools = withDelegate("tool", gpu, d -> createTools(toolFile, d));
            android.app.Activity activity = getActivity();
            if (!id.equals(session) || activity == null || activity.isDestroyed()) {
                closeModels();
                call.reject("Session closed");
                return;
            }
            activity.runOnUiThread(
                    () -> {
                        if (!id.equals(session)) {
                            call.reject("Session closed");
                            return;
                        }
                        showCamera(id, call);
                    });
        } catch (Exception error) {
            closeModels();
            android.app.Activity activity = getActivity();
            if (activity != null && !activity.isDestroyed())
                activity.runOnUiThread(
                        () -> {
                            if (id.equals(session)) stopSession(false);
                        });
            call.reject("네이티브 인식 모델을 준비하지 못했어요.", "MODEL_INIT");
        }
    }

    private BaseOptions base(String file, Delegate delegate) {
        return BaseOptions.builder().setModelAssetPath(assets + file).setDelegate(delegate).build();
    }

    private FaceLandmarker createFace(Delegate delegate) {
        return FaceLandmarker.createFromOptions(
                getContext(),
                FaceLandmarker.FaceLandmarkerOptions.builder()
                        .setBaseOptions(base("face_landmarker.task", delegate))
                        .setRunningMode(RunningMode.VIDEO)
                        .setNumFaces(2)
                        .setOutputFaceBlendshapes(false)
                        .setOutputFacialTransformationMatrixes(false)
                        .build());
    }

    private HandLandmarker createHands(Delegate delegate) {
        return HandLandmarker.createFromOptions(
                getContext(),
                HandLandmarker.HandLandmarkerOptions.builder()
                        .setBaseOptions(base("hand_landmarker.task", delegate))
                        .setRunningMode(RunningMode.VIDEO)
                        .setNumHands(2)
                        .setMinHandDetectionConfidence(.5f)
                        .setMinHandPresenceConfidence(.5f)
                        .setMinTrackingConfidence(.5f)
                        .build());
    }

    private ObjectDetector createObjects(Delegate delegate) {
        return ObjectDetector.createFromOptions(
                getContext(),
                ObjectDetector.ObjectDetectorOptions.builder()
                        .setBaseOptions(base("efficientdet_lite0.tflite", delegate))
                        .setRunningMode(RunningMode.VIDEO)
                        .setScoreThreshold(.25f)
                        .setCategoryAllowlist(Arrays.asList("cup", "bottle"))
                        .setMaxResults(5)
                        .build());
    }

    private byte[] readAsset(String name, int max) throws IOException {
        try (InputStream input = getContext().getAssets().open(assets + name);
                ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] chunk = new byte[8192];
            int n;
            while ((n = input.read(chunk)) != -1) {
                if (output.size() + n > max) throw new IOException("Asset exceeds limit");
                output.write(chunk, 0, n);
            }
            return output.toByteArray();
        }
    }

    private String validatedToolFile() throws Exception {
        JSONObject manifest =
                new JSONObject(
                        new String(
                                readAsset("tool-model.json", 8192),
                                java.nio.charset.StandardCharsets.UTF_8));
        if (!manifest.getBoolean("validated")) return null;
        JSONObject evaluation = manifest.getJSONObject("evaluation");
        String file = manifest.getString("file");
        if (manifest.getInt("schemaVersion") != 1
                || !file.matches("tool-[a-zA-Z0-9_.-]+\\.tflite")
                || evaluation.getInt("trainSubjects") < 2
                || evaluation.getInt("evaluationSubjects") < 1
                || evaluation.getInt("images") < 20
                || evaluation.getDouble("AP") < .5
                || evaluation.getDouble("AP") > 1) throw new IOException("Unvalidated tool model");
        if (!manifest.getJSONArray("labels")
                .toString()
                .equals("[\"pill\",\"insulin_pen\",\"syringe\"]"))
            throw new IOException("Tool labels mismatch");
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(readAsset(file, 20_000_000));
        StringBuilder hex = new StringBuilder();
        for (byte b : digest) hex.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        if (!hex.toString().equals(manifest.getString("sha256")))
            throw new IOException("Tool checksum mismatch");
        return file;
    }

    private ObjectDetector createTools(String file, Delegate delegate) {
        return ObjectDetector.createFromOptions(
                getContext(),
                ObjectDetector.ObjectDetectorOptions.builder()
                        .setBaseOptions(base(file, delegate))
                        .setRunningMode(RunningMode.VIDEO)
                        .setScoreThreshold(.5f)
                        .setCategoryAllowlist(Arrays.asList("pill", "insulin_pen", "syringe"))
                        .setMaxResults(5)
                        .build());
    }

    private TextView text(String value, int size) {
        TextView view = new TextView(getContext());
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(Color.rgb(35, 48, 42));
        view.setTypeface(Typeface.MONOSPACE);
        view.setPadding(20, 14, 20, 14);
        return view;
    }

    private void showCamera(String id, PluginCall call) {
        dialog =
                new Dialog(
                        getActivity(), android.R.style.Theme_Material_Light_NoActionBar_Fullscreen);
        LinearLayout layout = new LinearLayout(getContext());
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setBackgroundColor(Color.rgb(244, 231, 195));
        androidx.core.view.WindowCompat.setDecorFitsSystemWindows(dialog.getWindow(), false);
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(
                layout,
                (view, insets) -> {
                    androidx.core.graphics.Insets bars =
                            insets.getInsets(
                                    androidx.core.view.WindowInsetsCompat.Type.systemBars()
                                            | androidx.core.view.WindowInsetsCompat.Type
                                                    .displayCutout());
                    view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                    return insets;
                });
        LinearLayout header = new LinearLayout(getContext());
        TextView title = text(injection ? "주사·인슐린 동작" : "물·경구 복약 동작", 18);
        header.addView(title, new LinearLayout.LayoutParams(0, -2, 1));
        Button close = new Button(getContext());
        close.setText("닫기");
        close.setOnClickListener(v -> stopSession(true));
        header.addView(close);
        layout.addView(header);
        FrameLayout viewfinder = new FrameLayout(getContext());
        viewfinder.setBackgroundColor(Color.BLACK);
        preview = new PreviewView(getContext());
        preview.setImplementationMode(PreviewView.ImplementationMode.COMPATIBLE);
        preview.setScaleType(PreviewView.ScaleType.FIT_CENTER);
        viewfinder.addView(preview, new FrameLayout.LayoutParams(-1, -1));
        overlay = new TargetOverlay();
        viewfinder.addView(overlay, new FrameLayout.LayoutParams(-1, -1));
        overlay.setOnTouchListener(
                (v, event) -> {
                    if (!injection) return false;
                    if (event.getAction() == MotionEvent.ACTION_UP && id.equals(session)) {
                        RectF rect = overlay.content();
                        if (rect.contains(event.getX(), event.getY())) {
                            JSObject point = new JSObject();
                            point.put("sessionId", id);
                            point.put("x", 1 - (event.getX() - rect.left) / rect.width());
                            point.put("y", (event.getY() - rect.top) / rect.height());
                            notifyListeners("motionTap", point);
                        }
                        v.performClick();
                    }
                    return true;
                });
        layout.addView(viewfinder, new LinearLayout.LayoutParams(-1, 0, 1));
        hold = new ProgressBar(getContext(), null, android.R.attr.progressBarStyleHorizontal);
        hold.setMax(1000);
        layout.addView(hold, new LinearLayout.LayoutParams(-1, 12));
        status = text(injection ? "관찰할 부위를 화면에서 터치해 주세요." : "얼굴·손·컵을 화면에 담아 주세요.", 16);
        layout.addView(status);
        TextView engine = text("NATIVE · " + delegates, 11);
        layout.addView(engine);
        if (call.getBoolean("recordFeatures", false)) {
            Button finish = new Button(getContext());
            finish.setText("관찰 마치고 특징 확인");
            finish.setOnClickListener(
                    v -> {
                        if (id.equals(session)) {
                            JSObject event = new JSObject();
                            event.put("sessionId", id);
                            notifyListeners("motionFinish", event);
                            stopSession(false);
                        }
                    });
            layout.addView(finish);
        }
        dialog.setContentView(layout);
        dialog.setOnCancelListener(d -> stopSession(true));
        dialog.show();
        dialog.getWindow().setBackgroundDrawable(new ColorDrawable(Color.rgb(244, 231, 195)));
        dialog.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        com.google.common.util.concurrent.ListenableFuture<ProcessCameraProvider> future =
                ProcessCameraProvider.getInstance(getContext());
        future.addListener(
                () -> {
                    try {
                        if (!id.equals(session)) {
                            call.reject("Session closed");
                            return;
                        }
                        camera = future.get();
                        Preview live =
                                new Preview.Builder()
                                        .setTargetResolution(new Size(640, 480))
                                        .build();
                        live.setSurfaceProvider(preview.getSurfaceProvider());
                        analysis =
                                new ImageAnalysis.Builder()
                                        .setTargetResolution(new Size(640, 480))
                                        .setBackpressureStrategy(
                                                ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                                        .setOutputImageFormat(
                                                ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
                                        .build();
                        analysis.setAnalyzer(analyzer, image -> analyze(id, image));
                        camera.bindToLifecycle(
                                (LifecycleOwner) getActivity(),
                                CameraSelector.DEFAULT_FRONT_CAMERA,
                                live,
                                analysis);
                        JSObject ready = new JSObject();
                        ready.put("backend", "android-native");
                        ready.put("delegate", delegates);
                        call.resolve(ready);
                    } catch (Exception error) {
                        if (id.equals(session)) stopSession(false);
                        call.reject("전면 카메라를 연결하지 못했어요.", "CAMERA_START");
                    }
                },
                ContextCompat.getMainExecutor(getContext()));
    }

    private void analyze(String id, ImageProxy image) {
        Bitmap raw = null, upright = null;
        MPImage input = null;
        long timestamp = SystemClock.elapsedRealtime();
        try {
            if (!id.equals(session) || !gate.accept(timestamp)) return;
            raw = image.toBitmap();
            int rotation = image.getImageInfo().getRotationDegrees();
            if (rotation != 0) {
                Matrix matrix = new Matrix();
                matrix.postRotate(rotation);
                upright =
                        Bitmap.createBitmap(
                                raw, 0, 0, raw.getWidth(), raw.getHeight(), matrix, false);
            } else upright = raw;
            if (previousWidth != upright.getWidth() || previousHeight != upright.getHeight()) {
                previousWidth = upright.getWidth();
                previousHeight = upright.getHeight();
                lastFace = null;
                lastObjects = null;
                lastTools = null;
                faceAt = objectsAt = toolsAt = -10000;
            }
            input = new BitmapImageBuilder(upright).build();
            if (!injection && (lastFace == null || timestamp - faceAt >= 160)) {
                lastFace = face.detectForVideo(input, timestamp);
                faceAt = timestamp;
            }
            HandLandmarkerResult handResult = hands.detectForVideo(input, timestamp);
            if (tools != null && timestamp - toolsAt >= Math.max(250, gate.interval() * 3)) {
                lastTools = tools.detectForVideo(input, timestamp);
                toolsAt = timestamp;
            }
            if (objects != null && timestamp - objectsAt >= Math.max(250, gate.interval() * 3)) {
                lastObjects = objects.detectForVideo(input, timestamp);
                objectsAt = timestamp;
            }
            JSObject result = new JSObject();
            result.put("sessionId", id);
            result.put("timestamp", timestamp);
            result.put("frameWidth", upright.getWidth());
            result.put("frameHeight", upright.getHeight());
            JSArray faceList = new JSArray();
            if (lastFace != null && timestamp - faceAt <= 350)
                for (List<NormalizedLandmark> points : lastFace.faceLandmarks()) {
                    JSArray sparse = new JSArray();
                    for (int i : new int[] {13, 14, 234, 454}) {
                        JSObject point = point(points.get(i));
                        point.put("index", i);
                        sparse.put(point);
                    }
                    faceList.put(sparse);
                }
            result.put("faces", faceList);
            JSArray handList = new JSArray();
            for (List<NormalizedLandmark> points : handResult.landmarks()) {
                JSArray values = new JSArray();
                for (NormalizedLandmark point : points) values.put(point(point));
                handList.put(values);
            }
            result.put("hands", handList);
            JSArray found = new JSArray();
            if (lastObjects != null && timestamp - objectsAt <= 500)
                for (Detection detection : lastObjects.detections()) {
                    RectF box = detection.boundingBox();
                    JSObject value = new JSObject();
                    value.put("x", box.left);
                    value.put("y", box.top);
                    value.put("width", box.width());
                    value.put("height", box.height());
                    JSArray categories = new JSArray();
                    for (Category category : detection.categories()) {
                        JSObject c = new JSObject();
                        c.put("categoryName", category.categoryName());
                        c.put("score", category.score());
                        categories.put(c);
                    }
                    value.put("categories", categories);
                    found.put(value);
                }
            result.put("detections", found);
            result.put("objectObservedAt", objectsAt);
            JSArray toolList = new JSArray();
            if (lastTools != null && timestamp - toolsAt <= 500)
                for (Detection detection : lastTools.detections()) {
                    RectF box = detection.boundingBox();
                    JSObject value = new JSObject();
                    value.put("x", box.left);
                    value.put("y", box.top);
                    value.put("width", box.width());
                    value.put("height", box.height());
                    JSArray categories = new JSArray();
                    for (Category category : detection.categories()) {
                        JSObject c = new JSObject();
                        c.put("categoryName", category.categoryName());
                        c.put("score", category.score());
                        categories.put(c);
                    }
                    value.put("categories", categories);
                    toolList.put(value);
                }
            result.put("toolDetections", toolList);
            result.put("toolObservedAt", toolsAt);
            result.put("toolModelReady", tools != null);
            long latency = SystemClock.elapsedRealtime() - timestamp;
            gate.record(latency);
            result.put("latencyMs", latency);
            result.put("frames", gate.frames());
            result.put("throttledFrames", gate.throttled());
            result.put("p50Ms", gate.percentile(.5));
            result.put("p95Ms", gate.percentile(.95));
            result.put("delegate", delegates);
            int width = upright.getWidth(), height = upright.getHeight();
            getActivity()
                    .runOnUiThread(
                            () -> {
                                if (id.equals(session) && overlay != null) {
                                    overlay.width = width;
                                    overlay.height = height;
                                    overlay.invalidate();
                                } else if (overlay != null) {
                                    overlay.selected = false;
                                    overlay.invalidate();
                                }
                            });
            if (id.equals(session)) notifyListeners("motionFrame", result);
        } catch (Exception error) {
            if (id.equals(session)) {
                JSObject failure = new JSObject();
                failure.put("sessionId", id);
                failure.put("message", "네이티브 인식을 계속할 수 없어요. 카메라를 다시 시작해 주세요.");
                notifyListeners("motionError", failure);
                getActivity()
                        .runOnUiThread(
                                () -> {
                                    if (id.equals(session)) stopSession(false);
                                });
            }
        } finally {
            if (input != null) input.close();
            if (upright != null && upright != raw) upright.recycle();
            if (raw != null) raw.recycle();
            image.close();
        }
    }

    private JSObject point(NormalizedLandmark landmark) {
        JSObject value = new JSObject();
        value.put("x", landmark.x());
        value.put("y", landmark.y());
        value.put("z", landmark.z());
        return value;
    }

    @PluginMethod
    public void setProgress(PluginCall call) {
        String id = call.getString("sessionId", "");
        getActivity()
                .runOnUiThread(
                        () -> {
                            if (id.equals(session) && status != null) {
                                status.setText(call.getString("message", ""));
                                hold.setProgress(
                                        (int)
                                                Math.round(
                                                        call.getDouble("holdProgress", 0d) * 1000));
                                JSObject region = call.getObject("region");
                                if (region != null && overlay != null) {
                                    overlay.x = (float) region.optDouble("x", .5d);
                                    overlay.y = (float) region.optDouble("y", .5d);
                                    overlay.radius = (float) region.optDouble("radius", .12d);
                                    overlay.selected = true;
                                    overlay.invalidate();
                                }
                            }
                            call.resolve();
                        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        String id = call.getString("sessionId", "");
        getActivity()
                .runOnUiThread(
                        () -> {
                            if (id.equals(pending)) pending = null;
                            if (id.equals(session)) stopSession(false);
                            call.resolve();
                        });
    }

    private void stopSession(boolean notify) {
        String previous = session;
        session = null;
        if (analysis != null) {
            analysis.clearAnalyzer();
            if (camera != null) camera.unbind(analysis);
            analysis = null;
        }
        if (camera != null) {
            camera.unbindAll();
            camera = null;
        }
        Dialog current = dialog;
        dialog = null;
        if (current != null) current.dismiss();
        status = null;
        overlay = null;
        preview = null;
        // Models must close on the same serial thread that owns GPU inference.
        if (!analyzer.isShutdown()) analyzer.execute(this::closeModels);
        if (notify && previous != null) {
            JSObject event = new JSObject();
            event.put("sessionId", previous);
            notifyListeners("motionStopped", event);
        }
    }

    private void closeModels() {
        for (AutoCloseable model : new AutoCloseable[] {face, hands, objects, tools})
            if (model != null)
                try {
                    model.close();
                } catch (Exception ignored) {
                }
        face = null;
        hands = null;
        objects = null;
        tools = null;
        lastTools = null;
        lastFace = null;
        lastObjects = null;
    }

    @Override
    protected void handleOnPause() {
        pending = null;
        if (session != null) stopSession(true);
    }

    @Override
    protected void handleOnDestroy() {
        pending = null;
        stopSession(false);
        analyzer.shutdown();
    }

    private final class TargetOverlay extends View {
        int width = 480, height = 640;
        float x = .5f, y = .5f, radius = .12f;
        boolean selected = false;
        final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);

        TargetOverlay() {
            super(MotionVisionPlugin.this.getContext());
            setContentDescription("관찰할 부위 선택");
        }

        RectF content() {
            float scale = Math.min(getWidth() / (float) width, getHeight() / (float) height);
            float w = width * scale, h = height * scale;
            return new RectF(
                    (getWidth() - w) / 2,
                    (getHeight() - h) / 2,
                    (getWidth() + w) / 2,
                    (getHeight() + h) / 2);
        }

        @Override
        protected void onDraw(Canvas canvas) {
            super.onDraw(canvas);
            if (!selected) return;
            RectF rect = content();
            paint.setColor(Color.rgb(248, 210, 93));
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(5);
            canvas.drawCircle(
                    rect.left + (1 - x) * rect.width(),
                    rect.top + y * rect.height(),
                    radius * Math.min(rect.width(), rect.height()),
                    paint);
        }

        @Override
        public boolean performClick() {
            super.performClick();
            return true;
        }
    }
}
