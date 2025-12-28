
/**
 * Applies a threshold filter to an image source.
 * @param source Image source URL
 * @param threshold Value between 0 and 255
 * @returns Promise resolving to a base64 encoded processed image string
 */
export const applyThreshold = async (source: string, threshold: number): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = source;
    
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }

      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        
        // Simple luminance thresholding
        const brightness = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const val = brightness >= threshold ? 255 : 0;
        
        data[i] = val;     // Red
        data[i + 1] = val; // Green
        data[i + 2] = val; // Blue
        // Alpha stays the same
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };

    img.onerror = (err) => reject(err);
  });
};
