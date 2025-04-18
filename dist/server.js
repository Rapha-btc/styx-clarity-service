import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { getProofData, getProofGenerationData, extractProofInfo } from 'clarity-bitcoin-client';
import fetch from 'node-fetch';
// Load environment variables
dotenv.config();
// Add API key authentication
const API_KEY = process.env.API_KEY || 'your-secure-api-key-here';
const app = express();
// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());
// API key authentication middleware
app.use((req, res, next) => {
    const providedKey = req.headers['x-api-key'];
    if (!providedKey || providedKey !== API_KEY) {
        return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
    }
    next();
});
function getRpcParams() {
    return {
        rpcHost: `http://${process.env.RPC_HOST || 'localhost'}`, // Add http:// prefix
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
        let blockHash = req.query.blockHash || '';
        console.log(`Processing request for txid: ${txid}`);
        // If no blockHash provided, try to get it from the transaction
        if (!blockHash) {
            try {
                console.log("No blockhash provided, attempting to retrieve transaction info...");
                const rpcParams = getRpcParams();
                console.log("RPC Params:", JSON.stringify(rpcParams));
                // Make RPC call to get transaction info
                const requestBody = JSON.stringify({
                    jsonrpc: '1.0',
                    id: 'bitcoin-rpc',
                    method: 'getrawtransaction',
                    params: [txid, true]
                });
                console.log("RPC Request:", requestBody);
                const response = await fetch(`http://${process.env.RPC_HOST || 'localhost'}:${process.env.RPC_PORT || '8332'}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Basic ' + Buffer.from(`${process.env.RPC_USER || ''}:${process.env.RPC_PASS || ''}`).toString('base64')
                    },
                    body: requestBody
                });
                // Log the raw response
                const rawResponse = await response.text();
                console.log("Raw RPC Response:", rawResponse);
                // Parse the response
                const txInfo = JSON.parse(rawResponse);
                console.log("Parsed txInfo:", JSON.stringify(txInfo));
                if (txInfo.result && txInfo.result.blockhash) {
                    blockHash = txInfo.result.blockhash;
                    console.log(`Found blockhash: ${blockHash} for txid: ${txid}`);
                }
                else if (txInfo.error) {
                    console.error("RPC Error:", JSON.stringify(txInfo.error));
                }
                else {
                    console.error("No blockhash found in transaction info");
                }
            }
            catch (error) {
                console.error('Error getting transaction info:', error);
            }
        }
        console.log(`Using blockhash: "${blockHash}" for getProofData call`);
        // Get proof data
        const data = await getProofData(txid, blockHash, getRpcParams());
        console.log("Proof data retrieved successfully");
        const pgd = getProofGenerationData(data);
        console.log("Proof generation data created");
        const proof = extractProofInfo(pgd, data);
        console.log("Proof extracted successfully");
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
// Transaction status endpoint
app.get('/api/tx/:txid/status', async (req, res) => {
    try {
        const { txid } = req.params;
        console.log(`Processing transaction status request for txid: ${txid}`);
        // Make RPC call to get transaction info from Bitcoin node
        const requestBody = JSON.stringify({
            jsonrpc: '1.0',
            id: 'bitcoin-rpc',
            method: 'getrawtransaction',
            params: [txid, true]
        });
        console.log("RPC Request for transaction:", requestBody);
        const response = await fetch(`http://${process.env.RPC_HOST || 'localhost'}:${process.env.RPC_PORT || '8332'}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + Buffer.from(`${process.env.RPC_USER || ''}:${process.env.RPC_PASS || ''}`).toString('base64')
            },
            body: requestBody
        });
        // Parse the response
        const rawResponse = await response.text();
        const txInfo = JSON.parse(rawResponse);
        if (txInfo.error) {
            console.error("RPC Error:", JSON.stringify(txInfo.error));
            return res.status(500).json({
                error: txInfo.error.message || 'Error retrieving transaction',
                txid: txid
            });
        }
        if (!txInfo.result) {
            return res.status(404).json({
                error: 'Transaction not found',
                txid: txid
            });
        }
        // Check if transaction is confirmed (has a blockhash)
        const confirmed = !!txInfo.result.blockhash;
        // If confirmed, get additional block info
        let blockHeight, blockTime;
        if (confirmed) {
            // Get block info
            const blockRequestBody = JSON.stringify({
                jsonrpc: '1.0',
                id: 'bitcoin-rpc',
                method: 'getblock',
                params: [txInfo.result.blockhash]
            });
            const blockResponse = await fetch(`http://${process.env.RPC_HOST || 'localhost'}:${process.env.RPC_PORT || '8332'}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Basic ' + Buffer.from(`${process.env.RPC_USER || ''}:${process.env.RPC_PASS || ''}`).toString('base64')
                },
                body: blockRequestBody
            });
            const blockRawResponse = await blockResponse.text();
            const blockInfo = JSON.parse(blockRawResponse);
            if (blockInfo.result) {
                blockHeight = blockInfo.result.height;
                blockTime = blockInfo.result.time;
            }
        }
        // Return the transaction status in the same format as mempool.space API
        res.json({
            confirmed: confirmed,
            block_height: blockHeight,
            block_hash: txInfo.result.blockhash,
            block_time: blockTime
        });
    }
    catch (error) {
        console.error('Error processing transaction status request:', error);
        res.status(500).json({
            error: error instanceof Error ? error.message : 'Unknown error',
            txid: req.params.txid
        });
    }
});
// Bitcoin fee endpoint
app.get('/api/bitcoin/fees', async (req, res) => {
    try {
        const providedKey = req.headers['x-api-key'];
        if (!providedKey || providedKey !== process.env.API_KEY) {
            return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
        }
        console.log("Processing Bitcoin fee estimation request");
        // Make RPC call to get fee estimation from Bitcoin node
        const requestBody = JSON.stringify({
            jsonrpc: '1.0',
            id: 'bitcoin-rpc',
            method: 'estimatesmartfee',
            params: [2] // Target 2 blocks for medium fee
        });
        const mediumFeeResponse = await fetch(`http://${process.env.RPC_HOST || 'localhost'}:${process.env.RPC_PORT || '8332'}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + Buffer.from(`${process.env.RPC_USER || ''}:${process.env.RPC_PASS || ''}`).toString('base64')
            },
            body: requestBody
        });
        const mediumFeeText = await mediumFeeResponse.text();
        const mediumFeeData = JSON.parse(mediumFeeText);
        // Get low fee (6 blocks)
        const lowFeeRequest = JSON.stringify({
            jsonrpc: '1.0',
            id: 'bitcoin-rpc',
            method: 'estimatesmartfee',
            params: [6] // Target 6 blocks for low fee
        });
        const lowFeeResponse = await fetch(`http://${process.env.RPC_HOST || 'localhost'}:${process.env.RPC_PORT || '8332'}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + Buffer.from(`${process.env.RPC_USER || ''}:${process.env.RPC_PASS || ''}`).toString('base64')
            },
            body: lowFeeRequest
        });
        const lowFeeText = await lowFeeResponse.text();
        const lowFeeData = JSON.parse(lowFeeText);
        // Get high fee (1 block)
        const highFeeRequest = JSON.stringify({
            jsonrpc: '1.0',
            id: 'bitcoin-rpc',
            method: 'estimatesmartfee',
            params: [1] // Target 1 block for high fee
        });
        const highFeeResponse = await fetch(`http://${process.env.RPC_HOST || 'localhost'}:${process.env.RPC_PORT || '8332'}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + Buffer.from(`${process.env.RPC_USER || ''}:${process.env.RPC_PASS || ''}`).toString('base64')
            },
            body: highFeeRequest
        });
        const highFeeText = await highFeeResponse.text();
        const highFeeData = JSON.parse(highFeeText);
        // Calculate fee rates
        // Bitcoin RPC returns BTC/kB, we need sat/vB
        // 100000000 sats per BTC / 1000 vBytes per kB = 100000 conversion factor
        const CONVERSION_FACTOR = 100000;
        let medium = Math.round((mediumFeeData.result?.feerate || 0.0001) * CONVERSION_FACTOR);
        let low = Math.round((lowFeeData.result?.feerate || 0.00005) * CONVERSION_FACTOR);
        let high = Math.round((highFeeData.result?.feerate || 0.0002) * CONVERSION_FACTOR);
        // Ensure minimum values and proper ordering
        low = Math.max(1, low);
        medium = Math.max(low + 1, medium);
        high = Math.max(medium + 1, high);
        res.json({
            low,
            medium,
            high
        });
    }
    catch (error) {
        console.error('Error processing fee estimation request:', error);
        res.status(500).json({
            error: error instanceof Error ? error.message : 'Unknown error',
            fallback: { low: 1, medium: 2, high: 5 }
        });
    }
});
// Add a new endpoint for fetching transaction hex
app.get('/api/tx/:txid/hex', async (req, res) => {
    try {
        const { txid } = req.params;
        const providedKey = req.headers['x-api-key'];
        if (!providedKey || providedKey !== process.env.API_KEY) {
            return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
        }
        console.log(`Processing transaction hex request for txid: ${txid}`);
        // Make RPC call to get raw transaction
        const requestBody = JSON.stringify({
            jsonrpc: '1.0',
            id: 'bitcoin-rpc',
            method: 'getrawtransaction',
            params: [txid]
        });
        const response = await fetch(`http://${process.env.RPC_HOST || 'localhost'}:${process.env.RPC_PORT || '8332'}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + Buffer.from(`${process.env.RPC_USER || ''}:${process.env.RPC_PASS || ''}`).toString('base64')
            },
            body: requestBody
        });
        const text = await response.text();
        const txData = JSON.parse(text);
        if (txData.error) {
            console.error("RPC Error:", JSON.stringify(txData.error));
            return res.status(500).json({
                error: txData.error.message || 'Error retrieving transaction',
                txid: txid
            });
        }
        if (!txData.result) {
            return res.status(404).json({
                error: 'Transaction not found',
                txid: txid
            });
        }
        // Return the raw transaction hex
        res.set('Content-Type', 'text/plain');
        res.send(txData.result);
    }
    catch (error) {
        console.error('Error processing transaction hex request:', error);
        res.status(500).json({
            error: error instanceof Error ? error.message : 'Unknown error',
            txid: req.params.txid
        });
    }
});
// Endpoint for getting full transaction data - fix the format
app.get('/api/tx/:txid', async (req, res) => {
    try {
        const { txid } = req.params;
        const providedKey = req.headers['x-api-key'];
        if (!providedKey || providedKey !== process.env.API_KEY) {
            return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
        }
        console.log(`Processing transaction data request for txid: ${txid}`);
        // Make RPC call to get raw transaction
        const requestBody = JSON.stringify({
            jsonrpc: '1.0',
            id: 'bitcoin-rpc',
            method: 'getrawtransaction',
            params: [txid, true] // true for verbose output
        });
        const response = await fetch(`http://${process.env.RPC_HOST || 'localhost'}:${process.env.RPC_PORT || '8332'}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + Buffer.from(`${process.env.RPC_USER || ''}:${process.env.RPC_PASS || ''}`).toString('base64')
            },
            body: requestBody
        });
        const text = await response.text();
        const txData = JSON.parse(text);
        if (txData.error) {
            console.error("RPC Error:", JSON.stringify(txData.error));
            return res.status(500).json({
                error: txData.error.message || 'Error retrieving transaction',
                txid: txid
            });
        }
        if (!txData.result) {
            return res.status(404).json({
                error: 'Transaction not found',
                txid: txid
            });
        }
        // Convert to mempool.space API format (IMPORTANT: Include scriptpubkey)
        const mempoolFormatTx = {
            txid: txData.result.txid,
            version: txData.result.version,
            locktime: txData.result.locktime,
            vin: txData.result.vin.map((input) => ({
                txid: input.txid,
                vout: input.vout,
                scriptsig: input.scriptsig || "",
                sequence: input.sequence,
                witness: input.witness || []
            })),
            vout: txData.result.vout.map((output, index) => ({
                scriptpubkey: output.scriptPubKey.hex, 
                scriptpubkey_asm: output.scriptPubKey.asm,
                scriptpubkey_type: output.scriptPubKey.type,
                value: output.value,
                n: index
            })),
            status: {
                confirmed: !!txData.result.blockhash,
                block_height: txData.result.height,
                block_hash: txData.result.blockhash,
                block_time: txData.result.blocktime
            }
        };
        console.log(`Response format for output 0:`, JSON.stringify(mempoolFormatTx.vout[0]));
        res.json(mempoolFormatTx);
    }
    catch (error) {
        console.error('Error processing transaction data request:', error);
        res.status(500).json({
            error: error instanceof Error ? error.message : 'Unknown error',
            txid: req.params.txid
        });
    }
});
// Add a UTXO fetching endpoint
app.get('/api/address/:address/utxo', async (req, res) => {
    try {
        const { address } = req.params;
        const providedKey = req.headers['x-api-key'];
        if (!providedKey || providedKey !== process.env.API_KEY) {
            return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
        }
        console.log(`Processing UTXO request for address: ${address}`);
        // Make RPC call to get UTXOs
        const requestBody = JSON.stringify({
            jsonrpc: '1.0',
            id: 'bitcoin-rpc',
            method: 'scantxoutset',
            params: ['start', [`addr(${address})`]]
        });
        const response = await fetch(`http://${process.env.RPC_HOST || 'localhost'}:${process.env.RPC_PORT || '8332'}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Basic ' + Buffer.from(`${process.env.RPC_USER || ''}:${process.env.RPC_PASS || ''}`).toString('base64')
            },
            body: requestBody
        });
        const text = await response.text();
        const utxoData = JSON.parse(text);
        if (utxoData.error) {
            console.error("RPC Error:", JSON.stringify(utxoData.error));
            return res.status(500).json({
                error: utxoData.error.message || 'Error retrieving UTXOs',
                address: address
            });
        }
        if (!utxoData.result || !utxoData.result.unspents) {
            return res.json([]);
        }
        // Convert to mempool.space API format
        const formattedUtxos = utxoData.result.unspents.map(utxo => {
            const [txid, vout] = utxo.txid.split(':');
            return {
                txid,
                vout: parseInt(vout),
                value: Math.round(utxo.amount * 100000000), // Convert BTC to satoshis
                status: {
                    confirmed: true
                }
            };
        });
        res.json(formattedUtxos);
    }
    catch (error) {
        console.error('Error processing UTXO request:', error);
        res.status(500).json({
            error: error instanceof Error ? error.message : 'Unknown error',
            address: req.params.address
        });
    }
});
// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Bitcoin proof service running on port ${PORT}`);
    console.log(`RPC host: ${process.env.RPC_HOST || 'localhost'}`);
});
