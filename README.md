# 实时订单簿深度可视化与量化网格交易引擎

基于Vue 3 + FastAPI的量化交易工具，WebSocket行情推送、Canvas订单簿深度热力图、网格策略回测引擎。

## 目标用户
量化交易爱好者、金融工程学生、日交易员

## 技术栈
- 前端: Vue 3 + TypeScript + Vite + Pinia + Element Plus + ECharts
- 后端: Python FastAPI + NumPy + SQLite + WebSocket

## 核心功能
1. WebSocket实时行情推送：模拟股票tick级别数据流(买一/卖一/成交量/时间)
2. Canvas订单簿深度热力图：买卖盘口10档深度可视化，红绿双向柱状图
3. ECharts K线图+网格上下轨+持仓标记叠加渲染
4. 网格交易策略引擎：价格区间/网格数量/每格资金参数配置
5. 策略回测：逐笔模拟 + 持仓收益计算 + 夏普比率/最大回撤/胜率统计
6. 回测报告：收益率曲线、逐格成交记录、绩效指标汇总
