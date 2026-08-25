#!/usr/bin/env node
/**
 * 通过阿里云 ECS Cloud Assistant（RunCommand）把官网静态包部署到 aixflow.com.cn 服务器。
 *
 * 前置：已执行 pack + upload-website-deploy-to-oss
 * 用法：node scripts/deploy-website-to-ecs.mjs
 *
 * 环境变量（可选）：
 *   ECS_INSTANCE_ID / ECS_PUBLIC_IP / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET
 */
import crypto from 'crypto';
import fs from 'fs';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const zipName = `Aixflow-Website-${version}.zip`;
const wgetUrl = `https://nexflow-temp-images-bj.oss-cn-beijing.aliyuncs.com/aixflow%20uploads/deploy/${encodeURIComponent(zipName)}`;
const DEFAULT_IP = '47.99.144.24';
const REGIONS = String(process.env.ECS_REGION || 'cn-hangzhou,cn-beijing,cn-shanghai,cn-shenzhen,cn-hongkong,cn-zhangjiakou,cn-huhehaote,cn-chengdu')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function decodeBase64Utf8(v) {
  try {
    return Buffer.from(String(v || ''), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function creds() {
  const accessKeyId = String(
    process.env.OSS_ACCESS_KEY_ID ||
      process.env.ALIBABA_CLOUD_ACCESS_KEY_ID ||
      decodeBase64Utf8('TFRBSTV0N3BKRFo1clpqVEJ5RHJVc0tX'),
  ).trim();
  const accessKeySecret = String(
    process.env.OSS_ACCESS_KEY_SECRET ||
      process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET ||
      decodeBase64Utf8('eDBOcG80dWx1TnltN3ZkZGJtYXVaamtRemg4NUNF'),
  ).trim();
  if (!accessKeyId || !accessKeySecret) {
    throw new Error('缺少 AccessKey');
  }
  return { accessKeyId, accessKeySecret };
}

function percentEncode(s) {
  return encodeURIComponent(String(s))
    .replace(/!/g, '%21')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

function signAndRequest(region, action, params) {
  const { accessKeyId, accessKeySecret } = creds();
  const common = {
    Format: 'JSON',
    Version: '2014-05-26',
    AccessKeyId: accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    SignatureVersion: '1.0',
    SignatureNonce: crypto.randomBytes(16).toString('hex'),
    RegionId: region,
    Action: action,
    ...params,
  };
  const sorted = Object.keys(common)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(common[k])}`)
    .join('&');
  const stringToSign = `GET&${percentEncode('/')}&${percentEncode(sorted)}`;
  const signature = crypto
    .createHmac('sha1', `${accessKeySecret}&`)
    .update(stringToSign)
    .digest('base64');
  const query = `${sorted}&Signature=${percentEncode(signature)}`;
  const url = `https://ecs.${region}.aliyuncs.com/?${query}`;

  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          let json;
          try {
            json = JSON.parse(body);
          } catch {
            reject(new Error(`ECS API 非 JSON: ${body.slice(0, 300)}`));
            return;
          }
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`${action} HTTP ${res.statusCode}: ${json.Message || body.slice(0, 300)}`));
            return;
          }
          if (json.Code && json.Code !== '200' && !json.RequestId) {
            reject(new Error(`${action} failed: ${json.Message || json.Code}`));
            return;
          }
          if (json.Message && json.HostId && !json.Instances && !json.InvokeId && !json.Command) {
            reject(new Error(`${action}: ${json.Message}`));
            return;
          }
          resolve(json);
        });
      })
      .on('error', reject);
  });
}

function instanceIps(i) {
  const pubs = i?.PublicIpAddress?.IpAddress || [];
  const pubArr = Array.isArray(pubs) ? pubs : [pubs];
  const eip = i?.EipAddress?.IpAddress;
  return [...pubArr, eip].filter(Boolean);
}

async function resolveInstance() {
  const fromEnv = String(process.env.ECS_INSTANCE_ID || '').trim();
  const regionEnv = String(process.env.ECS_REGION || '').trim();
  if (fromEnv && regionEnv && !regionEnv.includes(',')) {
    return { instanceId: fromEnv, region: regionEnv };
  }
  const ip = String(process.env.ECS_PUBLIC_IP || DEFAULT_IP).trim();
  const errors = [];
  for (const region of REGIONS) {
    try {
      const all = await signAndRequest(region, 'DescribeInstances', { PageSize: 50 });
      if (all?.Message && all?.Code) {
        errors.push(`${region}: ${all.Message}`);
        continue;
      }
      const instances = all?.Instances?.Instance || [];
      const flat = Array.isArray(instances) ? instances : [instances];
      if (fromEnv) {
        const byId = flat.find((i) => i?.InstanceId === fromEnv);
        if (byId) return { instanceId: fromEnv, region };
      }
      const byIp = flat.find((i) => instanceIps(i).includes(ip));
      if (byIp?.InstanceId) return { instanceId: byIp.InstanceId, region };
      if (flat.length) {
        console.log(
          `[deploy-ecs] ${region}: ${flat.length} 台实例，IP 未匹配 (${flat
            .map((i) => `${i.InstanceId}:${instanceIps(i).join('|') || '-'}`)
            .join(', ')})`,
        );
      }
    } catch (e) {
      errors.push(`${region}: ${e?.message || e}`);
    }
  }
  throw new Error(
    `未找到公网 IP ${ip} 对应的 ECS 实例。${errors.length ? `详情: ${errors.join(' | ')}` : '当前 AK 可能无 ECS 权限或实例在其他账号/区域'}`,
  );
}

function deployShell() {
  return `set -e
cd /tmp
rm -rf aixflow-website-deploy-tmp
mkdir -p aixflow-website-deploy-tmp
cd aixflow-website-deploy-tmp
wget -q -O ${zipName} "${wgetUrl}"
unzip -oq ${zipName}
test -f site/installer.html
test -f site/index.html
mkdir -p /var/www/aixflow/public /var/www/aixflow/assets
cp site/index.html /var/www/aixflow/public/index.html
cp site/recharge.html /var/www/aixflow/public/recharge.html
cp site/installer.html /var/www/aixflow/public/installer.html
cp site/icon.png /var/www/aixflow/icon.png
cp -r site/assets/* /var/www/aixflow/assets/
echo DEPLOY_OK
ls /var/www/aixflow/public/installer.html /var/www/aixflow/assets/aixflowInstaller-*.js
head -n 12 /var/www/aixflow/public/installer.html
`;
}

async function waitInvoke(region, instanceId, invokeId) {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await signAndRequest(region, 'DescribeInvocationResults', {
      InvokeId: invokeId,
      InstanceId: instanceId,
    });
    const list = res?.Invocation?.InvocationResults?.InvocationResult || [];
    const arr = Array.isArray(list) ? list : [list];
    const item = arr[0];
    if (!item) continue;
    const status = item.InvocationStatus || item.Status;
    if (status === 'Success' || status === 'Finished') {
      const out = item.Output ? Buffer.from(item.Output, 'base64').toString('utf8') : '';
      return { status, out, item };
    }
    if (['Failed', 'Cancelled', 'Timeout', 'Invalid', 'Aborted'].includes(status)) {
      const out = item.Output ? Buffer.from(item.Output, 'base64').toString('utf8') : '';
      throw new Error(`RunCommand ${status}: ${item.ErrorInfo || out || JSON.stringify(item).slice(0, 400)}`);
    }
    process.stdout.write(`[deploy-ecs] status=${status || 'Pending'} …\n`);
  }
  throw new Error('RunCommand 超时未完成');
}

async function main() {
  console.log(`[deploy-ecs] version=${version}`);
  console.log(`[deploy-ecs] wget=${wgetUrl}`);
  const { instanceId, region } = await resolveInstance();
  console.log(`[deploy-ecs] region=${region} instanceId=${instanceId}`);

  const run = await signAndRequest(region, 'RunCommand', {
    Type: 'RunShellScript',
    Name: `aixflow-website-${version}`,
    CommandContent: Buffer.from(deployShell(), 'utf8').toString('base64'),
    ContentEncoding: 'Base64',
    Timeout: 120,
    'InstanceId.1': instanceId,
  });
  const invokeId = run.InvokeId;
  if (!invokeId) {
    throw new Error(`RunCommand 无 InvokeId: ${JSON.stringify(run).slice(0, 400)}`);
  }
  console.log(`[deploy-ecs] InvokeId=${invokeId}`);
  const { out } = await waitInvoke(region, instanceId, invokeId);
  console.log(out || '(no output)');
  if (!String(out || '').includes('DEPLOY_OK')) {
    throw new Error('部署脚本未输出 DEPLOY_OK');
  }
  console.log('\n[deploy-ecs] 完成。请验证:');
  console.log('  https://aixflow.com.cn/  （「下载安装」应直链 Aixflow-Installer-*.exe；installer.html 仅可选）');
  console.log('  https://aixflow.com.cn/');
}

main().catch((e) => {
  console.error('[deploy-ecs] 失败:', e?.message || e);
  process.exit(1);
});
