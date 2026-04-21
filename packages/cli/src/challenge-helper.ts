/**
 * Challenge-Response Helper
 * 
 * 轻量级辅助函数，用于需要 Challenge-Response 认证的请求
 */

import { sendRequest } from './http-client.js';
import { signChallenge } from '@f2a/network';
import type { RFC008IdentityFile, Challenge } from '@f2a/network';

/**
 * 发送需要 Challenge-Response 认证的请求
 * 
 * 流程：
 * 1. 第一次请求 → 如果返回 challenge
 * 2. 签名 challenge → 第二次请求带 challengeResponse
 * 
 * @param method HTTP 方法
 * @param path API 路径
 * @param payload 请求体
 * @param identity Agent 身份文件（包含私钥）
 * @returns 最终结果
 */
export async function sendWithChallengeResponse(
  method: string,
  path: string,
  payload: Record<string, unknown>,
  identity: RFC008IdentityFile
): Promise<Record<string, unknown>> {
  // 第一次请求
  const initialResult = await sendRequest(method, path, payload);

  // 如果没有 challenge，直接返回
  if (!initialResult.challenge) {
    return initialResult;
  }

  // 签名 challenge
  const challenge = initialResult.challenge as Challenge;
  const response = signChallenge(challenge, identity.privateKey);

  // 第二次请求（带 challengeResponse）
  const finalPayload = {
    ...payload,
    challengeResponse: response,
  };

  return sendRequest(method, path, finalPayload);
}