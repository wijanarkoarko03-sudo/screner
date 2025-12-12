const express = require('express');
const axios = require('axios');
const cors = require('cors');
const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Cache system
const cache = new Map();
const CACHE_TTL = {
    ticker: 3000,      // 3 detik untuk ticker
    history: 5000,     // 5 detik untuk history
    depth: 2000        // 2 detik untuk depth
};

// Helper untuk request ke Indodax dengan retry
async function fetchIndodax(endpoint, params = {}) {
    const baseUrl = 'https://indodax.com';
    const url = `${baseUrl}${endpoint}`;
    
    try {
        console.log(`[FETCH] ${endpoint}`);
        
        const response = await axios.get(url, {
            timeout: 8000,
            params: params,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json',
                'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
            },
            httpsAgent: new (require('https').Agent)({ 
                rejectUnauthorized: false 
            })
        });
        
        return response.data;
    } catch (error) {
        console.error(`[ERROR] ${endpoint}:`, error.message);
        
        // Retry once
        if (error.code === 'ECONNABORTED' || error.response?.status >= 500) {
            console.log(`[RETRY] ${endpoint}`);
            try {
                const retryResponse = await axios.get(url, {
                    timeout: 10000,
                    params: params,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    },
                    httpsAgent: new (require('https').Agent)({ 
                        rejectUnauthorized: false 
                    })
                });
                return retryResponse.data;
            } catch (retryError) {
                throw new Error(`Retry failed: ${retryError.message}`);
            }
        }
        
        throw error;
    }
}

// ==============================
// API ENDPOINTS YANG BENAR
// ==============================

// 1. TICKER ALL - endpoint yang benar
app.get('/api/ticker_all', async (req, res) => {
    try {
        const cacheKey = 'ticker_all';
        const cached = cache.get(cacheKey);
        
        if (cached && (Date.now() - cached.timestamp < CACHE_TTL.ticker)) {
            console.log('[CACHE HIT] ticker_all');
            return res.json(cached.data);
        }
        
        const data = await fetchIndodax('/api/ticker_all');
        
        // Validasi data
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid ticker data format');
        }
        
        cache.set(cacheKey, {
            timestamp: Date.now(),
            data: data
        });
        
        console.log(`[SUCCESS] ticker_all: ${Object.keys(data.tickers || {}).length} pairs`);
        res.json(data);
        
    } catch (error) {
        console.error('ticker_all error:', error.message);
        res.status(500).json({ 
            error: 'Failed to fetch ticker data',
            message: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// 2. TRADINGVIEW HISTORY - endpoint yang benar
app.get('/api/tradingview/history', async (req, res) => {
    try {
        const { symbol, resolution, from, to } = req.query;
        
        if (!symbol || !resolution) {
            return res.status(400).json({ 
                error: 'Missing required parameters: symbol and resolution' 
            });
        }
        
        // Format symbol untuk Indodax (btcidr bukan btc_idr)
        let formattedSymbol = symbol.toLowerCase();
        if (formattedSymbol.includes('idr') && !formattedSymbol.includes('_')) {
            // Konversi BTCIDR -> btc_idr
            const base = formattedSymbol.replace('idr', '');
            formattedSymbol = `${base}_idr`;
        }
        
        const cacheKey = `history_${formattedSymbol}_${resolution}_${from}_${to}`;
        const cached = cache.get(cacheKey);
        
        if (cached && (Date.now() - cached.timestamp < CACHE_TTL.history)) {
            console.log(`[CACHE HIT] history: ${formattedSymbol}`);
            return res.json(cached.data);
        }
        
        const params = {
            symbol: formattedSymbol,
            resolution: resolution,
            from: parseInt(from),
            to: parseInt(to)
        };
        
        const data = await fetchIndodax('/api/tradingview/history', params);
        
        // Validasi response
        if (!data || data.s !== 'ok') {
            console.warn(`History data not ok for ${formattedSymbol}:`, data?.s);
            return res.json({ 
                s: 'no_data',
                t: [],
                o: [],
                h: [],
                l: [],
                c: [],
                v: []
            });
        }
        
        cache.set(cacheKey, {
            timestamp: Date.now(),
            data: data
        });
        
        console.log(`[SUCCESS] history: ${formattedSymbol} - ${data.t.length} candles`);
        res.json(data);
        
    } catch (error) {
        console.error('history error:', error.message);
        res.status(500).json({ 
            error: 'Failed to fetch history data',
            message: error.message,
            symbol: req.query.symbol
        });
    }
});

// 3. DEPTH/ORDER BOOK - endpoint yang benar
app.get('/api/depth/:pair', async (req, res) => {
    try {
        let { pair } = req.params;
        
        // Format pair untuk Indodax
        if (pair.includes('idr') && !pair.includes('_')) {
            const base = pair.replace('idr', '').toLowerCase();
            pair = `${base}_idr`;
        }
        
        const cacheKey = `depth_${pair}`;
        const cached = cache.get(cacheKey);
        
        if (cached && (Date.now() - cached.timestamp < CACHE_TTL.depth)) {
            console.log(`[CACHE HIT] depth: ${pair}`);
            return res.json(cached.data);
        }
        
        const data = await fetchIndodax(`/api/depth/${pair}`);
        
        cache.set(cacheKey, {
            timestamp: Date.now(),
            data: data
        });
        
        console.log(`[SUCCESS] depth: ${pair}`);
        res.json(data);
        
    } catch (error) {
        console.error('depth error:', error.message);
        
        // Return empty order book jika error
        res.json({
            buy: [],
            sell: []
        });
    }
});

// 4. SIMPLE TICKER (untuk debugging)
app.get('/api/ticker/:pair', async (req, res) => {
    try {
        let { pair } = req.params;
        
        if (pair.includes('idr') && !pair.includes('_')) {
            const base = pair.replace('idr', '').toLowerCase();
            pair = `${base}_idr`;
        }
        
        const data = await fetchIndodax(`/api/ticker/${pair}`);
        res.json(data);
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 5. SUMMARY (untuk volume 24h)
app.get('/api/summaries', async (req, res) => {
    try {
        const cacheKey = 'summaries';
        const cached = cache.get(cacheKey);
        
        if (cached && (Date.now() - cached.timestamp < CACHE_TTL.ticker)) {
            console.log('[CACHE HIT] summaries');
            return res.json(cached.data);
        }
        
        const data = await fetchIndodax('/api/summaries');
        
        cache.set(cacheKey, {
            timestamp: Date.now(),
            data: data
        });
        
        console.log(`[SUCCESS] summaries: ${Object.keys(data.tickers || {}).length} pairs`);
        res.json(data);
        
    } catch (error) {
        console.error('summaries error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// 6. GENERIC PROXY (fallback)
app.get('/proxy', async (req, res) => {
    try {
        const { url } = req.query;
        
        if (!url) {
            return res.status(400).json({ error: 'URL parameter required' });
        }
        
        // Decode URL
        const decodedUrl = decodeURIComponent(url);
        
        // Only allow Indodax URLs
        if (!decodedUrl.includes('indodax.com')) {
            return res.status(403).json({ error: 'Only Indodax URLs allowed' });
        }
        
        const response = await axios.get(decodedUrl, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            httpsAgent: new (require('https').Agent)({ 
                rejectUnauthorized: false 
            })
        });
        
        res.json(response.data);
        
    } catch (error) {
        console.error('Proxy error:', error.message);
        res.status(500).json({ 
            error: 'Proxy request failed',
            message: error.message 
        });
    }
});

// 7. HEALTH CHECK dengan test koneksi
app.get('/health', async (req, res) => {
    const health = {
        status: 'OK',
        service: 'Indodax Proxy Server',
        timestamp: new Date().toISOString(),
        cacheSize: cache.size,
        cacheEntries: Array.from(cache.keys()),
        endpoints: [
            '/api/ticker_all',
            '/api/tradingview/history',
            '/api/depth/:pair',
            '/api/ticker/:pair',
            '/api/summaries',
            '/proxy',
            '/health'
        ]
    };
    
    // Test connection to Indodax
    try {
        const testResponse = await axios.get('https://indodax.com/api/ticker/btc_idr', {
            timeout: 5000,
            httpsAgent: new (require('https').Agent)({ 
                rejectUnauthorized: false 
            })
        });
        
        health.indodaxStatus = 'CONNECTED';
        health.indodaxResponseTime = testResponse.headers['x-response-time'];
        
    } catch (error) {
        health.indodaxStatus = 'DISCONNECTED';
        health.indodaxError = error.message;
    }
    
    res.json(health);
});

// 8. CLEAR CACHE (untuk debugging)
app.get('/clear-cache', (req, res) => {
    const previousSize = cache.size;
    cache.clear();
    res.json({
        message: 'Cache cleared',
        previousSize: previousSize,
        currentSize: cache.size
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 IndoGain Proxy Server`);
    console.log(`📡 Running at http://localhost:${PORT}`);
    console.log(`\n📊 Available Endpoints:`);
    console.log(`   • http://localhost:${PORT}/api/ticker_all`);
    console.log(`   • http://localhost:${PORT}/api/tradingview/history`);
    console.log(`   • http://localhost:${PORT}/api/depth/:pair`);
    console.log(`   • http://localhost:${PORT}/api/ticker/:pair`);
    console.log(`   • http://localhost:${PORT}/api/summaries`);
    console.log(`   • http://localhost:${PORT}/health`);
    console.log(`\n🔧 Example requests:`);
    console.log(`   curl http://localhost:${PORT}/api/ticker_all | jq '.tickers | length'`);
    console.log(`   curl "http://localhost:${PORT}/api/tradingview/history?symbol=btc_idr&resolution=1&from=1700000000&to=1700000600"`);
});
