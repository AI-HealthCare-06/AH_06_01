/** Match object-fit: cover in the existing portrait viewfinder, before inference. */
export function inferenceFrame(width: number, height: number, aspectRatio = width / height) {
  const cropWidth = Math.min(width, height * aspectRatio);
  const cropHeight = cropWidth / aspectRatio;
  const scale = Math.min(1, 640 / cropWidth, 480 / cropHeight);
  return {
    x: (width - cropWidth) / 2,
    y: (height - cropHeight) / 2,
    width: cropWidth,
    height: cropHeight,
    resizeWidth: Math.round(cropWidth * scale),
    resizeHeight: Math.round(cropHeight * scale),
  };
}
