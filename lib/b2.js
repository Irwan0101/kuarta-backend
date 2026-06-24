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
  const { data: buckets } = await b2.getBucket({ bucketName });
  const bucket = buckets.find(b => b.bucketName === bucketName);
  if (!bucket) throw new Error(`Bucket "${bucketName}" not found`);
  const { data: upload } = await b2.getUploadUrl({ bucketId: bucket.bucketId });
  const ext = path.extname(fileName);
  const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const result = await b2.uploadFile({
    uploadUrl: upload.uploadUrl,
    uploadAuthToken: upload.authorizationToken,
    fileName: uniqueName,
    data: fileBuffer,
    contentType: contentType || 'application/octet-stream',
  });
  const publicUrl = `https://${bucketName}.s3.us-west-002.backblazeb2.com/${uniqueName}`;
  return publicUrl;
}
