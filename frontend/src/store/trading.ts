import { defineStore } from 'pinia'
import { ref } from 'vue'
import axios from 'axios'
import type { Tick, OrderBook, GridConfig, GridResult } from '@/types'

// 后端每 0.5s 推送一帧；超过此时长没收到任何帧即认为连接已失效
const STALE_TIMEOUT = 3000
const RECONNECT_DELAY = 1500

export const useTradingStore = defineStore('trading', () => {
  const loading = ref(false)
  const ticks = ref<Tick[]>([])
  const orderBook = ref<OrderBook | null>(null)
  const gridResult = ref<GridResult | null>(null)
  // 唯一的行情连接状态：顶部提示与所有面板都以此为准
  const wsConnected = ref(false)
  const config = ref<GridConfig>({ lowerPrice: 95, upperPrice: 115, gridCount: 20, capitalPerGrid: 1000, initialCapital: 100000 })

  const wsUrl = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`

  let ws: WebSocket | null = null
  let manualClose = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let staleTimer: ReturnType<typeof setTimeout> | null = null

  function clearStaleTimer() {
    if (staleTimer) { clearTimeout(staleTimer); staleTimer = null }
  }

  // 看门狗：持续收到行情帧时不断续期；一旦中断就强制关闭 socket，
  // 由 onclose 统一走“断开 → 清空行情 → 自动重连”流程
  function armStaleWatchdog() {
    clearStaleTimer()
    staleTimer = setTimeout(() => {
      const s = ws
      if (s && s.readyState !== WebSocket.CLOSED && s.readyState !== WebSocket.CLOSING) {
        try { s.close() } catch {}
      }
    }, STALE_TIMEOUT)
  }

  function resetMarketData() {
    // 断开后不保留上一轮行情，避免面板数据与“已断开”状态对不上
    ticks.value = []
    orderBook.value = null
  }

  function scheduleReconnect() {
    if (manualClose || reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      if (!manualClose) connectWS()
    }, RECONNECT_DELAY)
  }

  function connectWS() {
    manualClose = false
    // 同一条连接：已建立或正在建立时不重复创建
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    clearStaleTimer()

    const socket = new WebSocket(wsUrl)
    ws = socket

    socket.onopen = () => {
      if (socket !== ws) return
      wsConnected.value = true
      armStaleWatchdog()
    }

    socket.onmessage = (e) => {
      if (socket !== ws) return
      armStaleWatchdog()
      try {
        const d = JSON.parse(e.data)
        if (d.ticks) ticks.value = d.ticks.slice(-60)
        if (d.orderBook) orderBook.value = d.orderBook
      } catch {}
    }

    socket.onclose = () => {
      if (socket !== ws) return
      clearStaleTimer()
      ws = null
      wsConnected.value = false
      resetMarketData()
      scheduleReconnect()
    }

    socket.onerror = () => {
      // 浏览器随后会触发 onclose，断开/重连逻辑统一在那里处理
      try { socket.close() } catch {}
    }
  }

  // 标签页切回前台：切走期间连接可能已被回收/挂起，立即校正状态并重连
  function handleVisibility() {
    if (document.visibilityState !== 'visible' || manualClose) return
    const s = ws
    if (!s || s.readyState === WebSocket.CLOSED || s.readyState === WebSocket.CLOSING) {
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
      connectWS()
    } else if (s.readyState === WebSocket.OPEN) {
      // 重新计时：若帧不能很快恢复，看门狗会马上判定为失效并重连
      armStaleWatchdog()
    }
  }

  // 网络从离线恢复时立即重连，不必等定时器
  function handleOnline() {
    if (manualClose) return
    const s = ws
    if (!s || s.readyState === WebSocket.CLOSED || s.readyState === WebSocket.CLOSING) {
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
      connectWS()
    }
  }

  async function runBacktest() {
    loading.value = true
    try { const { data } = await axios.post('/api/backtest', config.value) ; gridResult.value = data }
    finally { loading.value = false }
  }

  function disconnectWS() {
    manualClose = true
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
    clearStaleTimer()
    const s = ws
    ws = null
    if (s) { try { s.close() } catch {} }
    wsConnected.value = false
    resetMarketData()
  }

  document.addEventListener('visibilitychange', handleVisibility)
  window.addEventListener('online', handleOnline)

  return { loading, ticks, orderBook, gridResult, wsConnected, config, connectWS, runBacktest, disconnectWS }
})
