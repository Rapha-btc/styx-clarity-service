import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { getProofData, getProofGenerationData, extractProofInfo } from 'clarity-bitcoin-client';
// Load environment variables
dotenv.config();
const app = express();
// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());
function getRpcParams() {
    return {
        rpcHost: process.env.RPC_HOST || 'localhost',
        rpcPort: parseInt(process.env.RPC_PORT || '8332'),
        rpcUser: process.env.RPC_USER || '',
        rpcPass: process.env.RPC_PASS || ''
    };
}
// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// Main proof endpoint
app.get('/api/proof/:txid', async (req, res) => {
    try {
        const { txid } = req.params;
        const blockHash = req.query.blockHash || null;
        console.log(`Processing request for txid: ${txid}`);
        // Get proof data - using getProofData instead of fetchApiData based on the library code
        const data = await getProofData(txid, blockHash || '', getRpcParams());
        const pgd = getProofGenerationData(data);
        const proof = extractProofInfo(pgd, data);
        res.json(proof);
    }
    catch (error) {
        console.error('Error processing request:', error);
        res.status(500).json({
            error: error instanceof Error ? error.message : 'Unknown error',
            txid: req.params.txid
        });
    }
});
// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Bitcoin proof service running on port ${PORT}`);
    console.log(`RPC host: ${process.env.RPC_HOST || 'localhost'}`);
});
