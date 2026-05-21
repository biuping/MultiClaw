import rateLimit from 'express-rate-limit';

/**
 * 通用速率限制
 * 默认 60 次/分钟，可通过 RATE_LIMIT_PER_MINUTE 环境变量调整
 */
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_PER_MINUTE || '60', 10),
  message: {
    success: false,
    error: '请求过于频繁，请稍后再试',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * 对话接口速率限制
 * 默认 10 次/分钟，防止 LLM 调用被滥用
 */
export const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.CHAT_RATE_LIMIT_PER_MINUTE || '10', 10),
  message: {
    success: false,
    error: '对话请求过于频繁，请稍后再试',
  },
  standardHeaders: true,
  legacyHeaders: false,
});
