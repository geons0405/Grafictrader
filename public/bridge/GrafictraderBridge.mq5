//+------------------------------------------------------------------+
//| GrafictraderBridge.mq5                                           |
//| Envia as velas deste MetaTrader 5 para o app Grafictrader, para  |
//| o app mostrar exatamente o mesmo gráfico da tua corretora e a IA |
//| analisar os mesmos preços que tu vês.                            |
//|                                                                  |
//| Instalação:                                                      |
//| 1. MT5 > Ficheiro > Abrir pasta de dados > MQL5 > Experts:       |
//|    copia este ficheiro e compila-o no MetaEditor (F7).           |
//| 2. MT5 > Ferramentas > Opções > Expert Advisors: ativa           |
//|    "Permitir WebRequest para os URL listados" e adiciona o URL   |
//|    do teu app (ex.: https://o-teu-app.vercel.app).               |
//| 3. Arrasta o EA para o gráfico (M1, M5, M15, H1 ou H4), cola a   |
//|    BridgeKey gerada no app (Perfil > MetaTrader 5) e ativa o     |
//|    "Algo Trading". O EA só lê preços: não abre nem fecha ordens. |
//+------------------------------------------------------------------+
#property copyright   "Grafictrader"
#property version     "1.00"
#property description "Envia as velas deste MT5 para o Grafictrader (só leitura, não opera)."

input string BridgeUrl    = "https://o-teu-app.vercel.app/api/mt5"; // URL do app terminado em /api/mt5
input string BridgeKey    = "";                                     // Chave gerada no app (Perfil > MetaTrader 5)
input string ExtraSymbols = "";                                     // Outros símbolos no mesmo timeframe, separados por vírgula
input int    SendSeconds  = 5;                                      // Intervalo de envio do preço (segundos)
input int    HistoryBars  = 500;                                    // Velas enviadas no envio completo

string   g_symbols[];
datetime g_lastBar[];
double   g_lastBid[];
datetime g_lastFull = 0;
string   g_tfName   = "";

string TimeframeName(ENUM_TIMEFRAMES tf)
{
   switch(tf)
   {
      case PERIOD_M1:  return "M1";
      case PERIOD_M5:  return "M5";
      case PERIOD_M15: return "M15";
      case PERIOD_H1:  return "H1";
      case PERIOD_H4:  return "H4";
   }
   return "";
}

void AddSymbol(string symbol)
{
   int size = ArraySize(g_symbols);
   ArrayResize(g_symbols, size + 1);
   ArrayResize(g_lastBar, size + 1);
   ArrayResize(g_lastBid, size + 1);
   g_symbols[size] = symbol;
   g_lastBar[size] = 0;
   g_lastBid[size] = 0;
}

int OnInit()
{
   g_tfName = TimeframeName((ENUM_TIMEFRAMES)_Period);
   if(g_tfName == "")
   {
      Print("Grafictrader: usa o gráfico em M1, M5, M15, H1 ou H4.");
      return INIT_PARAMETERS_INCORRECT;
   }
   if(StringLen(BridgeKey) < 20)
   {
      Print("Grafictrader: cola a BridgeKey gerada no app (Perfil > MetaTrader 5).");
      return INIT_PARAMETERS_INCORRECT;
   }

   ArrayResize(g_symbols, 0);
   AddSymbol(_Symbol);
   if(StringLen(ExtraSymbols) > 0)
   {
      string parts[];
      int n = StringSplit(ExtraSymbols, ',', parts);
      for(int i = 0; i < n; i++)
      {
         string s = parts[i];
         StringTrimLeft(s);
         StringTrimRight(s);
         if(StringLen(s) == 0 || s == _Symbol)
            continue;
         if(!SymbolSelect(s, true))
         {
            Print("Grafictrader: símbolo não encontrado na tua corretora: ", s);
            continue;
         }
         AddSymbol(s);
      }
   }

   EventSetTimer(MathMax(1, SendSeconds));
   g_lastFull = 0;
   SendAll();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   SendAll();
}

// Broker server time → UTC, rounded to 15 minutes.
int ServerOffsetSeconds()
{
   double offset = (double)(TimeTradeServer() - TimeGMT());
   return (int)(MathRound(offset / 900.0) * 900.0);
}

void SendAll()
{
   bool full = (TimeCurrent() - g_lastFull) >= 600 || g_lastFull == 0;
   if(full)
      g_lastFull = TimeCurrent();
   for(int i = 0; i < ArraySize(g_symbols); i++)
      SendSymbol(i, full);
}

void SendSymbol(int index, bool full)
{
   string symbol = g_symbols[index];
   int count = full ? HistoryBars : 3;
   MqlRates rates[];
   ArraySetAsSeries(rates, false);
   int copied = CopyRates(symbol, (ENUM_TIMEFRAMES)_Period, 0, count, rates);
   if(copied <= 0)
      return;

   double bid = SymbolInfoDouble(symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(symbol, SYMBOL_ASK);
   datetime newest = rates[copied - 1].time;

   string kind = "tick";
   if(full)
      kind = "full";
   else if(newest != g_lastBar[index])
      kind = "bar";
   else if(bid == g_lastBid[index])
      return; // nothing changed (market closed or no ticks)

   g_lastBar[index] = newest;
   g_lastBid[index] = bid;

   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   int offset = ServerOffsetSeconds();

   string candles = "";
   for(int i = 0; i < copied; i++)
   {
      if(i > 0)
         candles += ",";
      candles += "[" + IntegerToString((long)rates[i].time - offset) + ","
                 + DoubleToString(rates[i].open, digits) + ","
                 + DoubleToString(rates[i].high, digits) + ","
                 + DoubleToString(rates[i].low, digits) + ","
                 + DoubleToString(rates[i].close, digits) + ","
                 + IntegerToString((long)rates[i].tick_volume) + "]";
   }

   string json = "{\"symbol\":\"" + symbol + "\""
                 + ",\"timeframe\":\"" + g_tfName + "\""
                 + ",\"kind\":\"" + kind + "\""
                 + ",\"bid\":" + DoubleToString(bid, digits)
                 + ",\"ask\":" + DoubleToString(ask, digits)
                 + ",\"digits\":" + IntegerToString(digits)
                 + ",\"broker\":\"" + Escape(AccountInfoString(ACCOUNT_COMPANY)) + "\""
                 + ",\"server\":\"" + Escape(AccountInfoString(ACCOUNT_SERVER)) + "\""
                 + ",\"candles\":[" + candles + "]}";

   Post(json);
}

string Escape(string value)
{
   StringReplace(value, "\\", "\\\\");
   StringReplace(value, "\"", "\\\"");
   return value;
}

void Post(string json)
{
   char data[];
   char result[];
   string resultHeaders;
   int length = StringToCharArray(json, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(length > 0)
      ArrayResize(data, length - 1); // drop the terminating zero
   string headers = "Content-Type: application/json\r\nX-Bridge-Key: " + BridgeKey + "\r\n";
   ResetLastError();
   int status = WebRequest("POST", BridgeUrl, headers, 5000, data, result, resultHeaders);
   if(status == -1)
   {
      int error = GetLastError();
      if(error == 4014)
         Print("Grafictrader: adiciona o URL do app em Ferramentas > Opções > Expert Advisors > Permitir WebRequest.");
      else
         Print("Grafictrader: falha ao enviar (erro ", error, ").");
   }
   else if(status != 200)
   {
      Print("Grafictrader: o app respondeu ", status, ": ", CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8));
   }
}
//+------------------------------------------------------------------+
