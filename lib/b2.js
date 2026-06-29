import B2 from 'backblaze-b2';
import path from 'path';

const b2 = new B2({
  applicationKeyId: process.env.B2_KEY_ID,
  applicationKey: process.env.B2_APP_KEY,
});

let authed = false;

async function ensureAuth() {
  if (!authed) {
    await b2.authorize();
    authed = true;
  }
}

export async function uploadToB2(fileBuffer, fileName, contentType) {
  await ensureAuth();
  const bucketName = process.env.B2_BUCKET || 'kuarta';
  const res = await b2.getBucket({ bucketName });
  const buckets = Array.isArray(res.data) ? res.data : (res.data?.buckets || []);
  const bucket = buckets.find(b => b.bucketName === bucketName);
  if (!bucket) throw new Error(`Bucket "${bucketName}" not found`);
  const { data: upload } = await b2.getUploadUrl({ bucketId: bucket.bucketId });
  const ext = path.extname(fileName);
  const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  await b2.uploadFile({
    uploadUrl: upload.uploadUrl,
    uploadAuthToken: upload.authorizationToken,
    fileName: uniqueName,
    data: fileBuffer,
    contentType: contentType || 'application/octet-stream',
  });
  const publicUrl = `https://${bucketName}.s3.us-west-002.backblazeb2.com/${uniqueName}`;
  return publicUrl;
}

export async function deleteFromB2(fileName) {
  await ensureAuth();
  const bucketName = process.env.B2_BUCKET || 'kuarta';
  const res = await b2.getBucket({ bucketName });
  const buckets = Array.isArray(res.data) ? res.data : (res.data?.buckets || []);
  const bucket = buckets.find(b => b.bucketName === bucketName);
  if (!bucket) throw new Error(`Bucket "${bucketName}" not found`);
  const { data } = await b2.listFileNames({ bucketId: bucket.bucketId, startFileName: fileName, maxFileCount: 1 });
  const file = data.files?.find(f => f.fileName === fileName);
  if (!file) throw new Error(`File "${fileName}" tidak ditemukan di bucket`);
  await b2.deleteFileVersion({ fileId: file.fileId, fileName: file.fileName });
}
