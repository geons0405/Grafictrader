# Grafictrader

Mobile-first trading chart and market-intelligence application.

## Current
- LIVE market data from Binance public REST + WebSocket.
- CCXT integration on the server for unified exchange market data.
- Asset selector: BTC/USDT, ETH/USDT, BNB/USDT, SOL/USDT, XRP/USDT, ADA/USDT and DOGE/USDT.
- Timeframe selector: 1m, 5m, 15m, 1h and 4h.
- Interactive candlestick chart with TradingView Lightweight Charts.
- FOTO camera capture flow with server-side AI analysis endpoint.
- LIVE Intelligence panel opened from the settings icon.
- Realtime intelligence feed with tags, clickable events and event detail.
- GDELT news is available without a private API key.
- Optional Finnhub crypto news integration.
- Optional Twelve Data quote integration.
- Public Binance/CCXT market data requires no private trading credentials.
- No order execution is implemented.

## Intelligence providers

The /api/intelligence endpoint aggregates:
- GDELT news from the last hour.
- Binance market data through CCXT.
- Finnhub crypto news when FINNHUB_API_KEY is configured.
- Twelve Data live quote when TWELVE_DATA_API_KEY is configured.

The frontend refreshes the intelligence feed automatically every 12 seconds while the panel is open. Market price/candle updates remain on the Binance WebSocket.

## Environment variables

Configure these as server-side environment variables in Vercel:

```text
OPENAI_API_KEY=
FINNHUB_API_KEY=
TWELVE_DATA_API_KEY=
```

Never put private provider keys in src/main.js.

## Production

Vercel can build the project with:

```bash
npm install
npm run build
```

No order execution is implemented.
