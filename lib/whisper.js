// lib/whisper.js —— 本地 Whisper 语音识别（transformers.js + onnxruntime）
// 优先从本地 models/ 目录加载；本地缺失时才从 hf-mirror.com 下载
import { pipeline, env } from '@xenova/transformers';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.join(__dirname, '..', 'models');

// 优先本地，允许远程兜底（hf-mirror 国内镜像）
env.localModelPath = MODELS_DIR;
env.allowLocalModels = true;
env.allowRemoteModels = true;
env.remoteHost = 'https://hf-mirror.com';

// 单例
let transcriber = null;
let loadingPromise = null;

const MODEL_ID = 'Xenova/whisper-base'; // ~74MB，中文支持较好

// 判断本地是否已有模型文件（关键文件）
function isModelLocal() {
  const base = path.join(MODELS_DIR, 'Xenova', 'whisper-base');
  const needed = ['config.json', 'tokenizer.json', 'preprocessor_config.json',
    'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'];
  return needed.every(f => fs.existsSync(path.join(base, f)));
}

/**
 * 加载模型（幂等）
 * @param {(p: {phase:string, progress?:number, file?:string, msg?:string})=>void} onProgress
 *   phase: 'checking' | 'downloading' | 'loading' | 'ready' | 'error'
 *   progress: 0~100（仅 downloading 阶段）
 */
export async function loadModel(onProgress) {
  if (transcriber) { onProgress && onProgress({ phase: 'ready' }); return transcriber; }
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    // 阶段1：检查本地
    onProgress && onProgress({ phase: 'checking', msg: '正在检查本地模型…' });
    const local = isModelLocal();
    if (local) {
      onProgress && onProgress({ phase: 'loading', msg: '本地模型已就绪，正在加载到内存…', progress: 100 });
    } else {
      onProgress && onProgress({ phase: 'downloading', msg: '本地未找到模型，开始从 hf-mirror.com 下载（约74MB）…', progress: 0 });
    }

    // 阶段2：加载/下载（progress_callback 上报每个文件进度）
    const fileProgress = {}; // file -> percent
    transcriber = await pipeline('automatic-speech-recognition', MODEL_ID, {
      quantized: true,
      progress_callback: (info) => {
        if (!info || !info.file) return;
        if (info.status === 'progress' && typeof info.progress === 'number') {
          fileProgress[info.file] = info.progress;
          // 计算总体进度：所有文件的平均
          const vals = Object.values(fileProgress);
          const overall = vals.reduce((a, b) => a + b, 0) / vals.length;
          onProgress && onProgress({
            phase: 'downloading',
            progress: Math.round(overall),
            file: info.file,
            msg: `下载中 ${Math.round(overall)}% · ${info.file}`,
          });
        } else if (info.status === 'done') {
          fileProgress[info.file] = 100;
        }
      },
    });

    onProgress && onProgress({ phase: 'ready', msg: 'Whisper 模型加载完成' });
    return transcriber;
  })();
  return loadingPromise;
}

/**
 * 简单线性重采样：fromRate → 16000Hz
 * @param {Float32Array} samples 输入采样
 * @param {number} fromRate 输入采样率
 * @returns {Float32Array} 16kHz 采样
 */
export function resampleTo16k(samples, fromRate) {
  if (fromRate === 16000) return samples;
  const ratio = fromRate / 16000;
  const outLen = Math.floor(samples.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const i0 = Math.floor(srcIdx);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const frac = srcIdx - i0;
    out[i] = samples[i0] * (1 - frac) + samples[i1] * frac;
  }
  return out;
}

/**
 * 识别一段音频
 * @param {Float32Array} samples16k 16kHz 单声道 Float32 采样（-1~1）
 * @returns {Promise<string>} 识别出的文字
 */
export async function transcribe(samples16k) {
  if (!transcriber) throw new Error('模型未加载，请先调用 loadModel');
  // Whisper 要求至少约 0.5 秒音频，太短会报错
  if (samples16k.length < 8000) return '';
  const output = await transcriber(samples16k, {
    language: 'zh',
    task: 'transcribe',
    chunk_length_s: 30,
    stride_length_s: 5,
  });
  return (output && output.text ? output.text : '').trim();
}

export function isModelLoaded() { return !!transcriber; }
