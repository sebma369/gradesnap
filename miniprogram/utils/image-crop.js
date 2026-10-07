function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function fitImage(stageWidth, stageHeight, imageWidth, imageHeight) {
  const scale = Math.min(stageWidth / imageWidth, stageHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return { left: (stageWidth - width) / 2, top: (stageHeight - height) / 2, width, height };
}

function initialCrop(bounds) {
  const insetX = bounds.width * 0.06;
  const insetY = bounds.height * 0.06;
  return {
    left: bounds.left + insetX,
    top: bounds.top + insetY,
    width: bounds.width - 2 * insetX,
    height: bounds.height - 2 * insetY
  };
}

function adjustCrop(bounds, start, handle, dx, dy) {
  const right = start.left + start.width;
  const bottom = start.top + start.height;
  if (handle === 'move') {
    return {
      left: clamp(start.left + dx, bounds.left, bounds.left + bounds.width - start.width),
      top: clamp(start.top + dy, bounds.top, bounds.top + bounds.height - start.height),
      width: start.width, height: start.height
    };
  }
  const minWidth = Math.min(48, bounds.width / 2);
  const minHeight = Math.min(48, bounds.height / 2);
  const left = handle.includes('w') ? clamp(start.left + dx, bounds.left, right - minWidth) : start.left;
  const top = handle.includes('n') ? clamp(start.top + dy, bounds.top, bottom - minHeight) : start.top;
  const nextRight = handle.includes('e') ? clamp(right + dx, left + minWidth, bounds.left + bounds.width) : right;
  const nextBottom = handle.includes('s') ? clamp(bottom + dy, top + minHeight, bounds.top + bounds.height) : bottom;
  return { left, top, width: nextRight - left, height: nextBottom - top };
}

function sourceRect(bounds, crop, imageWidth, imageHeight) {
  const x = clamp(Math.round((crop.left - bounds.left) / bounds.width * imageWidth), 0, imageWidth - 1);
  const y = clamp(Math.round((crop.top - bounds.top) / bounds.height * imageHeight), 0, imageHeight - 1);
  return {
    x, y,
    width: Math.min(imageWidth - x, Math.max(1, Math.round(crop.width / bounds.width * imageWidth))),
    height: Math.min(imageHeight - y, Math.max(1, Math.round(crop.height / bounds.height * imageHeight)))
  };
}

module.exports = { fitImage, initialCrop, adjustCrop, sourceRect };
