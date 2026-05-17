
export interface PreprocessingOptions {
  threshold: number;
  holePatchingStrength?: number;
  noiseRemovalStrength?: number;
  smoothingStrength?: number;
}

const loadImage = (source: string): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = source;
  });
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const smoothImage = (imageData: ImageData, strength: number): ImageData => {
  const { width, height, data } = imageData;
  const output = new ImageData(width, height);
  const radius = clamp(Math.round(strength / 35), 1, 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      let count = 0;

      for (let oy = -radius; oy <= radius; oy++) {
        for (let ox = -radius; ox <= radius; ox++) {
          const nx = x + ox;
          const ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
            continue;
          }

          const index = (ny * width + nx) * 4;
          red += data[index];
          green += data[index + 1];
          blue += data[index + 2];
          alpha += data[index + 3];
          count++;
        }
      }

      const outputIndex = (y * width + x) * 4;
      output.data[outputIndex] = red / count;
      output.data[outputIndex + 1] = green / count;
      output.data[outputIndex + 2] = blue / count;
      output.data[outputIndex + 3] = alpha / count;
    }
  }

  return output;
};

const thresholdImage = (imageData: ImageData, threshold: number): ImageData => {
  const { data } = imageData;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const brightness = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const value = brightness >= threshold ? 255 : 0;

    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }

  return imageData;
};

const getBlackNeighborCount = (data: Uint8ClampedArray, width: number, height: number, x: number, y: number) => {
  let count = 0;

  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      if (ox === 0 && oy === 0) {
        continue;
      }

      const nx = x + ox;
      const ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        continue;
      }

      const index = (ny * width + nx) * 4;
      if (data[index] === 0) {
        count++;
      }
    }
  }

  return count;
};

const removeNoise = (imageData: ImageData, strength: number): ImageData => {
  const { width, height, data } = imageData;
  const output = new ImageData(new Uint8ClampedArray(data), width, height);
  const noiseLimit = clamp(1 + Math.round(strength / 25), 1, 8);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      if (data[index] !== 0) {
        continue;
      }

      const blackNeighbors = getBlackNeighborCount(data, width, height, x, y);
      if (blackNeighbors <= noiseLimit) {
        output.data[index] = 255;
        output.data[index + 1] = 255;
        output.data[index + 2] = 255;
      }
    }
  }

  return output;
};

const patchHoles = (imageData: ImageData, strength: number): ImageData => {
  const { width, height, data } = imageData;
  const output = new ImageData(new Uint8ClampedArray(data), width, height);
  const holeThreshold = clamp(8 - Math.round(strength / 20), 2, 8);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      if (data[index] !== 255) {
        continue;
      }

      const blackNeighbors = getBlackNeighborCount(data, width, height, x, y);
      if (blackNeighbors >= holeThreshold) {
        output.data[index] = 0;
        output.data[index + 1] = 0;
        output.data[index + 2] = 0;
      }
    }
  }

  return output;
};

/**
 * Applies thresholding and optional preprocessing to an image source.
 */
export const applyPreprocessing = async (source: string, options: PreprocessingOptions): Promise<string> => {
  const img = await loadImage(source);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('Could not get canvas context');
  }

  canvas.width = img.width;
  canvas.height = img.height;
  ctx.drawImage(img, 0, 0);

  let imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  if ((options.smoothingStrength ?? 0) > 0) {
    imageData = smoothImage(imageData, options.smoothingStrength ?? 0);
  }

  imageData = thresholdImage(imageData, options.threshold);

  if ((options.noiseRemovalStrength ?? 0) > 0) {
    imageData = removeNoise(imageData, options.noiseRemovalStrength ?? 0);
  }

  if ((options.holePatchingStrength ?? 0) > 0) {
    imageData = patchHoles(imageData, options.holePatchingStrength ?? 0);
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
};

/**
 * Applies only thresholding to an image source.
 */
export const applyThreshold = async (source: string, threshold: number): Promise<string> => {
  return applyPreprocessing(source, { threshold });
};
