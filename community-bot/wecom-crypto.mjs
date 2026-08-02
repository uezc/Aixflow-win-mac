/**
 * 企业微信回调加解密（兼容 EncodingAESKey）
 * 参考：https://developer.work.weixin.qq.com/document/path/90968
 */
import crypto from 'crypto';

function pkcs7Unpad(buf) {
  const pad = buf[buf.length - 1];
  if (pad < 1 || pad > 32) return buf;
  return buf.slice(0, buf.length - pad);
}

function pkcs7Pad(buf) {
  const block = 32;
  const pad = block - (buf.length % block);
  return Buffer.concat([buf, Buffer.alloc(pad, pad)]);
}

export function sha1Sign(token, timestamp, nonce, encrypt) {
  return crypto
    .createHash('sha1')
    .update([token, timestamp, nonce, encrypt].sort().join(''))
    .digest('hex');
}

export function decryptWecomMessage(encodingAesKey, corpId, encrypt) {
  const key = Buffer.from(`${encodingAesKey}=`, 'base64');
  const iv = key.slice(0, 16);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  decipher.setAutoPadding(false);
  const decrypted = pkcs7Unpad(
    Buffer.concat([decipher.update(Buffer.from(encrypt, 'base64')), decipher.final()]),
  );
  const msgLen = decrypted.readUInt32BE(16);
  const xml = decrypted.slice(20, 20 + msgLen).toString('utf8');
  const fromCorpId = decrypted.slice(20 + msgLen).toString('utf8');
  if (corpId && fromCorpId && fromCorpId !== corpId) {
    throw new Error(`corpId mismatch: ${fromCorpId}`);
  }
  return xml;
}

export function encryptWecomMessage(encodingAesKey, corpId, xml) {
  const key = Buffer.from(`${encodingAesKey}=`, 'base64');
  const iv = key.slice(0, 16);
  const random = crypto.randomBytes(16);
  const msg = Buffer.from(String(xml), 'utf8');
  const msgLen = Buffer.alloc(4);
  msgLen.writeUInt32BE(msg.length, 0);
  const corp = Buffer.from(String(corpId || ''), 'utf8');
  const raw = pkcs7Pad(Buffer.concat([random, msgLen, msg, corp]));
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(raw), cipher.final()]).toString('base64');
}

/** 极简 XML 取值（企微回调字段） */
export function xmlGet(xml, tag) {
  const re = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = String(xml || '').match(re);
  return (m?.[1] ?? m?.[2] ?? '').trim();
}

export function xmlGetAll(xml, tag) {
  const re = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(String(xml || '')))) {
    out.push((m[1] ?? m[2] ?? '').trim());
  }
  return out.filter(Boolean);
}
