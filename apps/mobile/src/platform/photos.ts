import * as ImagePicker from 'expo-image-picker';

/** One photo of one question (AI photo doubts). Never kept on the device after it is sent. */
export interface PickedPhoto {
  uri: string;
  width: number;
  height: number;
  mimeType: string;
}

export type PhotoResult = { status: 'picked'; photo: PickedPhoto } | { status: 'cancelled' } | { status: 'denied' };

/** The camera and the photo library behind one interface, so screens and tests don't touch the native module. */
export interface PhotoSource {
  takePhoto(): Promise<PhotoResult>;
  choosePhoto(): Promise<PhotoResult>;
}

const OPTIONS: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, quality: 0.7, exif: false, base64: false };

function toResult(r: ImagePicker.ImagePickerResult): PhotoResult {
  const a = r.canceled ? null : r.assets[0];
  if (!a) return { status: 'cancelled' };
  return { status: 'picked', photo: { uri: a.uri, width: a.width, height: a.height, mimeType: a.mimeType ?? 'image/jpeg' } };
}

/** expo-image-picker: asks for permission on first use; no EXIF (no location) is read. */
export const expoPhotoSource: PhotoSource = {
  async takePhoto() {
    const p = await ImagePicker.requestCameraPermissionsAsync();
    if (!p.granted) return { status: 'denied' };
    return toResult(await ImagePicker.launchCameraAsync(OPTIONS));
  },
  async choosePhoto() {
    const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!p.granted) return { status: 'denied' };
    return toResult(await ImagePicker.launchImageLibraryAsync(OPTIONS));
  },
};

/** FakePhotoSource for tests: returns what it is told to. */
export class FakePhotoSource implements PhotoSource {
  constructor(public next: PhotoResult = { status: 'picked', photo: { uri: 'file:///fake/question.jpg', width: 1200, height: 900, mimeType: 'image/jpeg' } }) {}
  async takePhoto() {
    return this.next;
  }
  async choosePhoto() {
    return this.next;
  }
}
