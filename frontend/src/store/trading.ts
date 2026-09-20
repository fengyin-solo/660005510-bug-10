import { defineStore } from 'pinia'
import { ref } from 'vue'
import axios from 'axios'
import type { Tick, OrderBook, GridConfig, GridResult } from '@/types'

// 重连退避：1s -> 2s -> 4s ... 封顶 10s
const RECONNECT_MIN = 1000
const RECONNECT_MAX = 10000
// 连接建立后 3s 内没有收到行情，视为中断
const HEARTBEAT_TIMEOUT = 3000

export const useTradingStore = defineStore('trading', () => {
  const loading = ref(false)
  const ticks = ref<Tick[]>([])
  const orderBook = ref<OrderBook | null>(null)
  const gridResult = ref<GridResult | null>(null)
  // 唯一的连接状态：顶部提示与各面板都从这里读取
  const wsConnected = ref(false)
  const config = ref<GridConfig>({ lowerPrice: 95, upperPrice: 115, gridCount: 20, capitalPerGrid: 1000, initialCapital: 100000 })

  let ws: WebSocket | null = null
  // 每次连接递增，旧连接的回调全部作废，避免旧 onclose 覆盖新状态
  let sessionSeq = 0
  let manualClosed = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectDelay = RECONNECT_MIN

  function clearReconnectTimer() {
    if (reconnectTimer !== null) { clearTimeout(reconnectTimer); reconnectTimer = null }
  }

  function clearHeartbeat() {
    if (heartbeatTimer !== null) { clearTimeout(heartbeatTimer); heartbeatTimer = null }
  }

  function markOffline(seq: number) {
    // 只有当前这一轮连接才允许更新状态，防止旧连接回调误改
    if (seq !== sessionSeq) return
    clearHeartbeat()
    wsConnected.value = false
    // 中断后立即丢弃上一轮行情，面板与提示保持一致
    ticks.value = []
    orderBook.value = null
    if (!manualClosed) scheduleReconnect()
  }

  function scheduleReconnect() {
    if (manualClosed || reconnectTimer !== null) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connectWS()
    }, reconnectDelay)
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX)
  }

  function connectWS() {
    // 已在连接中或已连通则不重复建连（刷新/重新进入页面路径复用同一条）
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
    clearReconnectTimer()
    manualClosed = false

    const seq = ++sessionSeq
    // 同源地址，开发环境经 Vite 代理转发到后端
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const socket = new WebSocket(`${proto}://${location.host}/ws`)
    ws = socket

    socket.onopen = () => {
      if (seq !== sessionSeq) return
      // 等收到第一帧真实行情后才标记为实时（由心跳回调完成）
      armHeartbeat(seq)
    }

    socket.onmessage = (e) => {
      if (seq !== sessionSeq) return
      let d: any
      try { d = JSON.parse(e.data) } catch { return }
      if (d.ticks) ticks.value = d.ticks.slice(-60)
      if (d.orderBook) orderBook.value = d.orderBook
      // 收到行情才算真正连通：顶部与面板统一恢复
      if (!wsConnected.value) {
        wsConnected.value = true
        reconnectDelay = RECONNECT_MIN
      }
      armHeartbeat(seq)
    }

    socket.onerror = () => {
      // 之后一般会紧跟 onclose；确保中断状态被感知
      if (seq === sessionSeq) socket.close()
    }

    socket.onclose = () => {
      if (seq !== sessionSeq) return
      ws = null
      markOffline(seq)
    }
  }

  function armHeartbeat(seq: number) {
    clearHeartbeat()
    heartbeatTimer = setTimeout(() => {
      // 连接还在但长时间没有数据：判定为中断并强制重连
      if (seq !== sessionSeq || ws === null) return
      try { ws.close() } catch {}
    }, HEARTBEAT_TIMEOUT)
  }

  // 页面从后台/缓存恢复时调用：该连就连，已连不动
  function ensureConnected() {
    if (manualClosed || !ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      connectWS()
    }
  }

  async function runBacktest() {
    loading.value = true
    try { const { data } = await axios.post('/api/backtest', config.value) ; gridResult.value = data }
    finally { loading.value = false }
  }

  function disconnectWS() {
    manualClosed = true
    clearReconnectTimer()
    clearHeartbeat()
    sessionSeq++
    const socket = ws
    ws = null
    if (socket) {
      try { socket.close() } catch {}
    }
    wsConnected.value = false
    ticks.value = []
    orderBook.value = null
  }

  return { loading, ticks, orderBook, gridResult, wsConnected, config, connectWS, ensureConnected, runBacktest, disconnectWS }
})
