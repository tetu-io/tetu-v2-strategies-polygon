import fs from 'fs';
import path from 'path';

/**
 * Create path's directory if it doesn't exist
 * and write data to the path's file
 */
export function writeFileSyncRestoreFolder(filePath: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, options?: fs.WriteFileOptions): void {
  const dir = path.dirname(filePath.toString());
  fs.mkdir(dir, { recursive: true }, (err) => {
    if (err) throw err;
  });
  fs.writeFileSync(filePath, data, options);
}
