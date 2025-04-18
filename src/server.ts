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

// RPC connection parameters
interface RpcParams {
  rpcHost: string;
  rpcPort: number;
  rpcUser: string;
  rpcPass: string;
}

function getRpcParams(): RpcParams {
  return {
    rpcHost: `http://${process.env.RPC_HOST || 'localhost'}`,  // Add http:// prefix
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
    let blockHash = req.query.blockHash as string || '';
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
        const txInfo = JSON.parse(rawResponse) as {
          result?: {
            blockhash?: string;
          };
          error?: any;
        };
        
        console.log("Parsed txInfo:", JSON.stringify(txInfo));
        
        if (txInfo.result && txInfo.result.blockhash) {
          blockHash = txInfo.result.blockhash;
          console.log(`Found blockhash: ${blockHash} for txid: ${txid}`);
        } else if (txInfo.error) {
          console.error("RPC Error:", JSON.stringify(txInfo.error));
        } else {
          console.error("No blockhash found in transaction info");
        }
      } catch (error) {
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
  } catch (error) {
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
    
  } catch (error) {
    console.error('Error processing transaction status request:', error);
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