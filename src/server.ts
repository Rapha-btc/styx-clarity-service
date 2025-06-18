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

// Health check endpoint (no API key required)
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    network: 'testnet',
    rpcHost: process.env.RPC_HOST,
    timestamp: new Date().toISOString() 
  });
});

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

// Add these type definitions at the top of your server.ts file

// Type definitions for Bitcoin RPC responses
interface RpcResponse<T> {
  result?: T;
  error?: {
    code: number;
    message: string;
  };
  id: string;
}

// Fee estimation response types
interface FeeEstimateResult {
  feerate: number;
  blocks: number;
}

// Transaction response types
interface TransactionInput {
  txid: string;
  vout: number;
  scriptsig: string;
  scriptsig_asm: string;
  sequence: number;
  witness?: string[];
}

interface TransactionOutput {
  scriptpubkey: string;
  scriptpubkey_asm: string;
  scriptpubkey_type: string;
  scriptpubkey_address?: string;
  value: number;
}

interface TransactionResult {
  txid: string;
  version: number;
  locktime: number;
  vin: TransactionInput[];
  vout: TransactionOutput[];
  blockhash?: string;
  confirmations?: number;
  time?: number;
  blocktime?: number;
}

// UTXO scan result types
interface Unspent {
  txid: string;
  vout: number;
  scriptPubKey: string;
  amount: number;
  height: number;
}

interface UtxoScanResult {
  success: boolean;
  unspents: Unspent[];
  total_amount: number;
}

// Define interfaces for Bitcoin RPC responses
interface BitcoinInput {
  txid: string;
  vout: number;
  scriptsig?: string;
  scriptsig_asm?: string;
  sequence: number;
  witness?: string[];
}

interface BitcoinScriptPubKey {
  hex: string;
  asm: string;
  type: string;
  addresses?: string[];
  address?: string;
}

interface BitcoinOutput {
  value: number;
  n: number;
  scriptPubKey: BitcoinScriptPubKey;
}

interface BitcoinTransaction {
  txid: string;
  version: number;
  locktime: number;
  vin: BitcoinInput[];
  vout: BitcoinOutput[];
  blockhash?: string;
  confirmations?: number;
  time?: number;
  blocktime?: number;
  height?: number;
}

// Health check endpoint
// app.get('/health', (req, res) => {
//   res.json({ status: 'ok', timestamp: new Date().toISOString() });
// });

// Main proof endpoint
// Replace your existing /api/proof/:txid endpoint with this enhanced version

app.get('/api/proof/:txid', async (req, res) => {
  try {
    const { txid } = req.params;
    let blockHash = req.query.blockHash as string || '';
    console.log(`🔍 [PROOF] Processing request for txid: ${txid}`);
    console.log(`🔍 [PROOF] Initial blockHash: "${blockHash}"`);
    
    // If no blockHash provided, try to get it from the transaction
    if (!blockHash) {
      try {
        console.log("🔄 [PROOF] No blockhash provided, attempting to retrieve transaction info...");
        const rpcParams = getRpcParams();
        console.log("🔧 [PROOF] RPC Params:", JSON.stringify({
          ...rpcParams,
          rpcPass: rpcParams.rpcPass ? '[REDACTED]' : 'NOT_SET'
        }));
        
        // Make RPC call to get transaction info
        const requestBody = JSON.stringify({
          jsonrpc: '1.0',
          id: 'bitcoin-rpc',
          method: 'getrawtransaction',
          params: [txid, true]
        });
        console.log("📡 [PROOF] RPC Request:", requestBody);
        
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
        console.log("📥 [PROOF] Raw RPC Response length:", rawResponse.length);
        console.log("📥 [PROOF] Raw RPC Response preview:", rawResponse.substring(0, 200));
        
        // Parse the response
        const txInfo = JSON.parse(rawResponse) as {
          result?: {
            blockhash?: string;
            version?: number;
            locktime?: number;
          };
          error?: any;
        };
        
        console.log("📋 [PROOF] Parsed txInfo keys:", Object.keys(txInfo.result || {}));
        console.log("📋 [PROOF] Transaction version from RPC:", txInfo.result?.version);
        console.log("📋 [PROOF] Transaction locktime from RPC:", txInfo.result?.locktime);
        
        if (txInfo.result && txInfo.result.blockhash) {
          blockHash = txInfo.result.blockhash;
          console.log(`✅ [PROOF] Found blockhash: ${blockHash} for txid: ${txid}`);
        } else if (txInfo.error) {
          console.error("❌ [PROOF] RPC Error:", JSON.stringify(txInfo.error));
          return res.status(500).json({
            error: `RPC Error: ${txInfo.error.message}`,
            txid: txid
          });
        } else {
          console.error("❌ [PROOF] No blockhash found in transaction info");
          return res.status(500).json({
            error: "Transaction not confirmed or not found",
            txid: txid
          });
        }
      } catch (error) {
        console.error('❌ [PROOF] Error getting transaction info:', error);
        return res.status(500).json({
          error: `Failed to get transaction info: ${error instanceof Error ? error.message : 'Unknown error'}`,
          txid: txid
        });
      }
    }
    
    console.log(`🎯 [PROOF] Using blockhash: "${blockHash}" for getProofData call`);
    
    // DEBUG: Let's see what data clarity-bitcoin-client receives
    console.log(`🔍 [DEBUG] About to debug what clarity-bitcoin-client receives...`);
    
    try {
      // Get the raw transaction
      const rawTxRequest = JSON.stringify({
        jsonrpc: '1.0',
        id: 'debug-tx',
        method: 'getrawtransaction',
        params: [txid, true]
      });
      
      const rawTxResponse = await fetch(`http://${process.env.RPC_HOST || 'localhost'}:${process.env.RPC_PORT || '8332'}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Basic ' + Buffer.from(`${process.env.RPC_USER || ''}:${process.env.RPC_PASS || ''}`).toString('base64')
        },
        body: rawTxRequest
      });
      
      const rawTxData = await rawTxResponse.json();
      
      // Get the block data
      const blockRequest = JSON.stringify({
        jsonrpc: '1.0',
        id: 'debug-block',
        method: 'getblock',
        params: [blockHash, true]
      });
      
      const blockResponse = await fetch(`http://${process.env.RPC_HOST || 'localhost'}:${process.env.RPC_PORT || '8332'}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Basic ' + Buffer.from(`${process.env.RPC_USER || ''}:${process.env.RPC_PASS || ''}`).toString('base64')
        },
        body: blockRequest
      });
      
      const blockData = await blockResponse.json();
      
      // Check if any of these numbers match our mystery "109112198"
      const mysteryNumber = 109112198;
      
      // Convert mystery number to hex to see if it makes sense
      console.log(`🔍 [DEBUG] Mystery number in hex: 0x${mysteryNumber.toString(16)}`);
      
    } catch (debugError) {
      console.error(`❌ [DEBUG] Error during debug:`, debugError);
    }
    
    console.log(`🔍 [DEBUG] Debug complete, now calling getProofData...`);
    console.log(`🔄 [PROOF] About to call getProofData from clarity-bitcoin-client...`);
    
    // Get proof data with enhanced error handling
    let data;
    try {
      const rpcParams = getRpcParams();
      console.log(`🔧 [PROOF] Final RPC params for getProofData:`, {
        rpcHost: rpcParams.rpcHost,
        rpcPort: rpcParams.rpcPort,
        rpcUser: rpcParams.rpcUser ? 'SET' : 'NOT_SET',
        rpcPass: rpcParams.rpcPass ? 'SET' : 'NOT_SET'
      });
      
      data = await getProofData(txid, blockHash, rpcParams);
      console.log("✅ [PROOF] getProofData completed successfully");
      console.log("📋 [PROOF] Data structure:", {
        hasData: !!data,
        dataKeys: data ? Object.keys(data) : [],
        dataType: typeof data
      });
    } catch (proofError: unknown) {
      // console.error("❌ [PROOF] getProofData failed:");
      // console.error("❌ [PROOF] Error type:", proofError.constructor.name);
      // console.error("❌ [PROOF] Error message:", (proofError as Error).message);
      // console.error("❌ [PROOF] Error stack:", proofError.stack?.split('\n').slice(0, 5));
      
      // Check if it's the specific version error
      if ((proofError as Error).message?.includes('Unknown version')) {
        console.error("🚨 [PROOF] This is the 'Unknown version' error we've been tracking!");
        console.error("🚨 [PROOF] Full error details:", JSON.stringify({
          message: (proofError as Error).message,
          name: (proofError as Error).name,
          txid: txid,
          blockHash: blockHash
        }, null, 2));
      }
      
      return res.status(500).json({
        error: `Failed to retrieve proof generation data for txid: ${txid} - wrapped error: ${(proofError as Error).message}`,
        txid: txid,
        details: {
          errorType: (proofError as Error).constructor.name,
          blockHash: blockHash,
          timestamp: new Date().toISOString()
        }
      });
    }
    
    console.log("🔄 [PROOF] About to call getProofGenerationData...");
    let pgd;
    try {
      pgd = getProofGenerationData(data);
      console.log("✅ [PROOF] getProofGenerationData completed");
    } catch (pgdError: unknown) {
      console.error("❌ [PROOF] getProofGenerationData failed:", pgdError);
      return res.status(500).json({
        error: `Failed during proof generation: ${(pgdError as Error).message}`,
        txid: txid
      });
    }
    
    console.log("🔄 [PROOF] About to call extractProofInfo...");
    let proof;
    try {
      proof = extractProofInfo(pgd, data);
      console.log("✅ [PROOF] extractProofInfo completed");
      console.log("📋 [PROOF] Final proof structure:", {
        hasProof: !!proof,
        proofKeys: proof ? Object.keys(proof) : [],
        segwit: proof?.segwit,
        height: proof?.height
      });
    } catch (extractError: unknown) {
      console.error("❌ [PROOF] extractProofInfo failed:", extractError);
      return res.status(500).json({
        error: `Failed during proof extraction: ${(extractError as Error).message}`,
        txid: txid
      });
    }
    
    console.log("🎉 [PROOF] All steps completed successfully, returning proof");
    res.json(proof);
    
  } catch (error) {
    console.error('❌ [PROOF] Unexpected error in proof endpoint:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      txid: req.params.txid,
      timestamp: new Date().toISOString()
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

// Bitcoin fee endpoint
app.get('/api/bitcoin/fees', async (req, res) => {
  try {
    const providedKey = req.headers['x-api-key'];
    
    if (!providedKey || providedKey !== process.env.API_KEY) {
      return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
    }
    
    console.log("Processing Bitcoin fee estimation request");
    
    // Make RPC call to get fee estimation from Bitcoin node - using 6 blocks as base
    const lowFeeRequest = JSON.stringify({
      jsonrpc: '1.0',
      id: 'bitcoin-rpc',
      method: 'estimatesmartfee',
      params: [6]  // Target 6 blocks for base fee
    });
    
    console.log("Requesting base fee estimate for 6 blocks");
    const lowFeeResponse = await fetch(`http://${process.env.RPC_HOST || 'localhost'}:${process.env.RPC_PORT || '8332'}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(`${process.env.RPC_USER || ''}:${process.env.RPC_PASS || ''}`).toString('base64')
      },
      body: lowFeeRequest
    });
    
    const lowFeeText = await lowFeeResponse.text();
    console.log("Base fee (6 blocks) response:", lowFeeText);
    const lowFeeData = JSON.parse(lowFeeText) as RpcResponse<FeeEstimateResult>;
    
    // Calculate fee rates
    const CONVERSION_FACTOR = 100000;
    
    // Get node's 6-block fee rate
    const baseFeeRate = lowFeeData.result?.feerate || 0.000002;
    
    console.log("Node's 6-block fee rate:", baseFeeRate);
    
    // Convert to sat/vB
    const baseSatsPerVbyte = Math.round(baseFeeRate * CONVERSION_FACTOR);
    console.log("Base fee rate in sat/vB:", baseSatsPerVbyte);
    
    // Derive other rates from the 6-block rate
    let low = Math.max(1, baseSatsPerVbyte);
    let medium = Math.max(low + 1, Math.round(low * 1.5));
    let high = Math.max(medium + 1, Math.round(low * 2));
    
    console.log("Derived fee rates before capping:");
    console.log("- Low:", low, "sat/vB");
    console.log("- Medium:", medium, "sat/vB");
    console.log("- High:", high, "sat/vB");
    
    // Cap at reasonable maximums
    const MAX_LOW = 5;
    const MAX_MEDIUM = 10;
    const MAX_HIGH = 20;
    
    if (low > MAX_LOW || medium > MAX_MEDIUM || high > MAX_HIGH) {
      console.log("Capping excessive fee rates");
      low = Math.min(low, MAX_LOW);
      medium = Math.min(medium, MAX_MEDIUM);
      high = Math.min(high, MAX_HIGH);
      
      // Re-adjust in case capping broke ordering
      medium = Math.max(low + 1, medium);
      high = Math.max(medium + 1, high);
    }
    
    console.log("Final fee rates after all adjustments:");
    console.log("- Low:", low, "sat/vB");
    console.log("- Medium:", medium, "sat/vB");
    console.log("- High:", high, "sat/vB");
    
    res.json({
      low,
      medium,
      high
    });
  } catch (error) {
    console.error('Error processing fee estimation request:', error);
    
    // Use reasonable fallback values
    const fallbackResponse = { low: 1, medium: 2, high: 3 };
    console.log("Using fallback fee rates due to error:", fallbackResponse);
    
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      fallback: fallbackResponse
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
    const txData = JSON.parse(text) as RpcResponse<string>;
    
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
  } catch (error) {
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
      params: [txid, true]  // true for verbose output
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
      vin: txData.result.vin.map((input: BitcoinInput) => ({
        txid: input.txid,
        vout: input.vout,
        scriptsig: input.scriptsig || "",
        sequence: input.sequence,
        witness: input.witness || []
      })),
      vout: txData.result.vout.map((output: BitcoinOutput, index: number) => ({
        scriptpubkey: output.scriptPubKey.hex, // IMPORTANT: Include this property
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
  } catch (error) {
    console.error('Error processing transaction data request:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      txid: req.params.txid 
    });
  }
});

// Add a UTXO fetching endpoint
// Enhanced UTXO fetching endpoint with better logging
// app.get('/api/address/:address/utxo', async (req, res) => {
//   try {
//     const { address } = req.params;
//     const providedKey = req.headers['x-api-key'];
    
//     console.log(`[UTXO] Processing UTXO request for address: ${address}`);
//     console.log(`[UTXO] API Key provided: ${providedKey ? 'Yes' : 'No'}`);
    
//     if (!providedKey || providedKey !== process.env.API_KEY) {
//       console.log(`[UTXO] Authentication failed. Expected: ${process.env.API_KEY}, Got: ${providedKey}`);
//       return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
//     }
    
//     console.log(`[UTXO] Authentication successful, proceeding with RPC call`);
//     console.log(`[UTXO] RPC Host: ${process.env.RPC_HOST || 'localhost'}`);
//     console.log(`[UTXO] RPC Port: ${process.env.RPC_PORT || '8332'}`);
//     console.log(`[UTXO] RPC User set: ${process.env.RPC_USER ? 'Yes' : 'No'}`);
    
//     // Make RPC call to get UTXOs
//     const requestBody = JSON.stringify({
//       jsonrpc: '1.0',
//       id: 'bitcoin-rpc',
//       method: 'scantxoutset',
//       params: ['start', [`addr(${address})`]]
//     });
    
//     console.log(`[UTXO] RPC Request: ${requestBody}`);
    
//     // Start timing the request
//     const startTime = Date.now();
    
//     try {
//       const response = await fetch(`http://${process.env.RPC_HOST || 'localhost'}:${process.env.RPC_PORT || '8332'}`, {
//         method: 'POST',
//         headers: {
//           'Content-Type': 'application/json',
//           'Authorization': 'Basic ' + Buffer.from(`${process.env.RPC_USER || ''}:${process.env.RPC_PASS || ''}`).toString('base64')
//         },
//         body: requestBody
//       });
      
//       const endTime = Date.now();
//       console.log(`[UTXO] RPC call took ${endTime - startTime}ms`);
      
//       if (!response.ok) {
//         console.log(`[UTXO] RPC HTTP error: ${response.status} ${response.statusText}`);
//       }
      
//       const text = await response.text();
//       console.log(`[UTXO] RPC Response length: ${text.length} bytes`);
      
//       // Log a preview of the response (first 200 characters)
//       console.log(`[UTXO] RPC Response preview: ${text.substring(0, 200)}...`);
      
//       const utxoData = JSON.parse(text) as RpcResponse<UtxoScanResult>;
      
//       if (utxoData.error) {
//         console.error(`[UTXO] RPC Error:`, JSON.stringify(utxoData.error));
//         return res.status(500).json({ 
//           error: utxoData.error.message || 'Error retrieving UTXOs',
//           address: address 
//         });
//       }
      
//       console.log(`[UTXO] Processing RPC result`);
//       if (!utxoData.result || !utxoData.result.unspents) {
//         console.log(`[UTXO] No UTXOs found for address ${address}`);
//         return res.json([]);
//       }
      
//       console.log(`[UTXO] Found ${utxoData.result.unspents.length} UTXOs for address ${address}`);
      
//       // Convert to mempool.space API format
//       const formattedUtxos = utxoData.result.unspents.map(utxo => {
//         // Log the UTXO format from Bitcoin Core
//         console.log(`[UTXO] Processing UTXO: ${JSON.stringify(utxo)}`);
        
//         // scantxoutset returns txid:vout format, need to split it
//         let txid, vout;
//         if (utxo.txid && utxo.txid.includes(':')) {
//           [txid, vout] = utxo.txid.split(':');
//         } else {
//           // Handle possible different format
//           console.log(`[UTXO] Unexpected UTXO format: ${JSON.stringify(utxo)}`);
//           txid = utxo.txid || '';
//           vout = utxo.vout || 0;
//         }
        
//         return {
//           txid,
//           vout: typeof vout === 'string' ? parseInt(vout) : vout,
//           value: Math.round((utxo.amount || 0) * 100000000), // Convert BTC to satoshis
//           status: {
//             confirmed: true
//           }
//         };
//       });
      
//       console.log(`[UTXO] Returning ${formattedUtxos.length} formatted UTXOs`);
//       res.json(formattedUtxos);
//     } catch (rpcError) {
//       console.error(`[UTXO] Error during RPC call: ${rpcError instanceof Error ? rpcError.message : 'Unknown error'}`);
//       console.error(`[UTXO] RPC call duration before error: ${Date.now() - startTime}ms`);
//       if (rpcError instanceof Error && rpcError.stack) {
//         console.error(`[UTXO] Error stack: ${rpcError.stack}`);
//       }
//       throw rpcError;
//     }
//   } catch (error) {
//     console.error(`[UTXO] Error processing UTXO request: ${error instanceof Error ? error.message : 'Unknown error'}`);
//     if (error instanceof Error && error.stack) {
//       console.error(`[UTXO] Error stack: ${error.stack}`);
//     }
//     res.status(500).json({ 
//       error: error instanceof Error ? error.message : 'Unknown error',
//       address: req.params.address 
//     });
//   }
// });
// Update to proxy requests to mempool.space instead of using scantxoutset
app.get('/api/address/:address/utxo', async (req, res) => {
  try {
    const { address } = req.params;
    const providedKey = req.headers['x-api-key'];
    
    if (!providedKey || providedKey !== process.env.API_KEY) {
      return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
    }
    
    console.log(`Proxying UTXO request for address: ${address} to mempool.space`);
    
    // Forward the request to mempool.space
    const mempoolResponse = await fetch(`https://mempool.space/api/address/${address}/utxo`);
    
    if (!mempoolResponse.ok) {
      throw new Error(`Mempool.space API error: ${mempoolResponse.status} ${mempoolResponse.statusText}`);
    }
    
    const utxos = await mempoolResponse.json();
    res.json(utxos);
  } catch (error) {
    console.error('Error processing UTXO request:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      address: req.params.address 
    });
  }
});

// Add this to your server.ts file, after your existing endpoints

// Kenny's bitcoin-tx-proof endpoint
app.get('/api/proof-kenny/:txid', async (req, res) => {
  try {
    const { txid } = req.params;
    let blockHash = req.query.blockHash as string || '';
    console.log(`🔍 [KENNY] Processing request for txid: ${txid}`);
    console.log(`🔍 [KENNY] Initial blockHash: "${blockHash}"`);
    
    // Import Kenny's tool
    const { bitcoinTxProof } = await import('bitcoin-tx-proof');
    
    // If no blockHash provided, try to get it from the transaction
    if (!blockHash) {
      try {
        console.log("🔄 [KENNY] No blockhash provided, attempting to retrieve transaction info...");
        
        const requestBody = JSON.stringify({
          jsonrpc: '1.0',
          id: 'bitcoin-rpc',
          method: 'getrawtransaction',
          params: [txid, true]
        });
        
        const response = await fetch(`http://${process.env.RPC_HOST || 'localhost'}:${process.env.RPC_PORT || '8332'}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Basic ' + Buffer.from(`${process.env.RPC_USER || ''}:${process.env.RPC_PASS || ''}`).toString('base64')
          },
          body: requestBody
        });
        
        const rawResponse = await response.text();
        const txInfo = JSON.parse(rawResponse) as {
          result?: { blockhash?: string; };
          error?: any;
        };
        
        if (txInfo.result && txInfo.result.blockhash) {
          blockHash = txInfo.result.blockhash;
          console.log(`✅ [KENNY] Found blockhash: ${blockHash} for txid: ${txid}`);
        } else if (txInfo.error) {
          console.error("❌ [KENNY] RPC Error:", JSON.stringify(txInfo.error));
          return res.status(500).json({
            error: `RPC Error: ${txInfo.error.message}`,
            txid: txid
          });
        } else {
          console.error("❌ [KENNY] No blockhash found in transaction info");
          return res.status(500).json({
            error: "Transaction not confirmed or not found",
            txid: txid
          });
        }
      } catch (error) {
        console.error('❌ [KENNY] Error getting transaction info:', error);
        return res.status(500).json({
          error: `Failed to get transaction info: ${error instanceof Error ? error.message : 'Unknown error'}`,
          txid: txid
        });
      }
    }

    // Get block height from block hash
    let blockHeight;
    try {
      const blockRequestBody = JSON.stringify({
        jsonrpc: '1.0',
        id: 'bitcoin-rpc',
        method: 'getblock',
        params: [blockHash]
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
      
      if (blockInfo.result && blockInfo.result.height) {
        blockHeight = blockInfo.result.height;
        console.log(`✅ [KENNY] Found block height: ${blockHeight} for block: ${blockHash}`);
      } else {
        throw new Error("Could not get block height");
      }
    } catch (error) {
      console.error('❌ [KENNY] Error getting block height:', error);
      return res.status(500).json({
        error: `Failed to get block height: ${error instanceof Error ? error.message : 'Unknown error'}`,
        txid: txid
      });
    }
    
    console.log(`🎯 [KENNY] Using Kenny's tool with txid: ${txid}, blockHeight: ${blockHeight}`);
    
    // Configure Kenny's RPC parameters
    const btcRPCConfig = {
      url: `http://${process.env.RPC_HOST || 'localhost'}:${process.env.RPC_PORT || '8332'}`,
      username: process.env.RPC_USER || '',
      password: process.env.RPC_PASS || ''
    };
    
    console.log(`🔧 [KENNY] RPC config:`, {
      url: btcRPCConfig.url,
      username: btcRPCConfig.username ? 'SET' : 'NOT_SET',
      password: btcRPCConfig.password ? 'SET' : 'NOT_SET'
    });
    
    // Use Kenny's bitcoinTxProof function
    console.log(`🔄 [KENNY] Calling Kenny's bitcoinTxProof...`);
    const proof = await bitcoinTxProof(txid, blockHeight, btcRPCConfig);
    
    console.log("✅ [KENNY] Kenny's bitcoinTxProof completed successfully");
    console.log("📋 [KENNY] Proof structure:", {
      hasProof: !!proof,
      proofKeys: proof ? Object.keys(proof) : [],
      blockHeight: proof?.blockHeight,
      txIndex: proof?.txIndex
    });
    
    // Convert Kenny's proof format to match your existing format
    // This ensures compatibility with your existing backend code
    const formattedProof = {
      ...proof,
      segwit: true, // Kenny's tool handles segwit transactions
      height: proof.blockHeight
    };
    
    console.log("🎉 [KENNY] Returning formatted proof");
    res.json(formattedProof);
    
  } catch (error) {
    console.error('❌ [KENNY] Unexpected error in Kenny proof endpoint:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      txid: req.params.txid,
      timestamp: new Date().toISOString()
    });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Bitcoin proof service running on port ${PORT}`);
  console.log(`RPC host: ${process.env.RPC_HOST || 'localhost'}`);
});