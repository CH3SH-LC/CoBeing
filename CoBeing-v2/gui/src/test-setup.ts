import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// 每个用例后清理 DOM（防止跨用例累积导致重复元素误判）
afterEach(() => {
  cleanup()
})
