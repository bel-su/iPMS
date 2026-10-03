import { describe, expect, it } from 'vitest';
import { dispositionFilename, entryName, packageFilename } from './photo-package';

describe('photo-package', () => {
  it('reads the file name from a content-disposition header', () => {
    expect(dispositionFilename('attachment; filename="IMG_001.jpg"')).toBe('IMG_001.jpg');
    expect(dispositionFilename("attachment; filename*=UTF-8''site%20photo.jpg")).toBe('site photo.jpg');
    expect(dispositionFilename(null)).toBeNull();
    expect(dispositionFilename('attachment')).toBeNull();
  });
  it('orders entries by checklist item, then photo, and never leaks a path', () => {
    expect(entryName(3, 2, 'IMG.jpg', null)).toBe('03-2-IMG.jpg');
    expect(entryName(12, 1, '../../etc/passwd', null)).toBe('12-1-_.._etc_passwd');
    expect(entryName(1, 1, null, 'image/png')).toBe('01-1.png');
    expect(entryName(1, 1, null, null)).toBe('01-1.jpg');
  });
  it('names the package after project and site', () => {
    expect(packageFilename('PRJ 01', 'S/12')).toBe('PRJ-01_S_12_photos.zip');
  });
});
