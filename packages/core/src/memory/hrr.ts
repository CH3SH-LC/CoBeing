/**
 * HRR (Holographic Reduced Representations) 接口 + Phase 2 桩实现
 *
 * Phase 2 将用 SHA-256 确定性相位向量替换 StubHrrEncoder。
 * 所有调用方按 HrrEncoder 接口编程，届时只需替换实例。
 *
 * 核心操作（Phase 2 实现规格）：
 * 1. encodeAtom(word): SHA-256(word) → 展开为 1024 个 [0, 2π) 相位值
 * 2. bind(a, b) = (a + b) % (2 * Math.PI)
 * 3. unbind(mem, key) = (mem - key) % (2 * Math.PI)
 * 4. bundle(*vectors): 复数指数圆形均值叠加
 *    bundle_i = atan2(mean(sin(vectors[*][i])), mean(cos(vectors[*][i])))
 * 5. similarity(a, b) = mean(cos(a[i] - b[i])) for i in 0..dim
 *
 * 实体提取正则（Phase 2 使用）：
 *   CAPITALIZED: /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g
 *   DOUBLE_QUOTE: /"([^"]+)"/g
 *   SINGLE_QUOTE: /'([^']+)'/g
 *   AKA: /(\w+(?:\s+\w+)*)\s+(?:aka|also known as)\s+(\w+(?:\s+\w+)*)/gi
 */

export type HrrVector = Float64Array;

export interface HrrEncoder {
  readonly dim: number;
  encodeAtom(word: string): HrrVector;
  bind(a: HrrVector, b: HrrVector): HrrVector;
  unbind(memory: HrrVector, key: HrrVector): HrrVector;
  bundle(...vectors: HrrVector[]): HrrVector;
  similarity(a: HrrVector, b: HrrVector): number;
}

export class StubHrrEncoder implements HrrEncoder {
  readonly dim = 1024;

  encodeAtom(_word: string): HrrVector {
    throw new Error("HRR Phase 2 not implemented");
  }

  bind(_a: HrrVector, _b: HrrVector): HrrVector {
    throw new Error("HRR Phase 2 not implemented");
  }

  unbind(_memory: HrrVector, _key: HrrVector): HrrVector {
    throw new Error("HRR Phase 2 not implemented");
  }

  bundle(..._vectors: HrrVector[]): HrrVector {
    throw new Error("HRR Phase 2 not implemented");
  }

  similarity(_a: HrrVector, _b: HrrVector): number {
    throw new Error("HRR Phase 2 not implemented");
  }
}
