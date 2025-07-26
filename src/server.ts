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

const kennyProofCache = new Map<string, any>();

// Track ongoing Kenny requests to prevent duplicates
const ongoingKennyRequests = new Map<string, Promise<any>>();

// Rate limiting for Kenny endpoint (optional but recommended)
const kennyRequestTracker = new Map<string, { count: number; resetTime: number }>();

// Track ongoing jobs for async processing
const kennyJobs = new Map<string, {
  status: 'processing' | 'completed' | 'failed';
  result?: any;
  error?: string;
  startTime: number;
}>();

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
  console.error("❌ [PROOF] Error message:", (extractError as Error).message);
  console.error("❌ [PROOF] Error stack:", (extractError as Error).stack);
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

const KENNY_RATE_LIMIT = 5; // Max 5 Kenny requests per hour per API key
const KENNY_RATE_WINDOW = 60 * 60 * 1000; // 1 hour

// Start Kenny processing (returns immediately)
app.post('/api/proof-kenny-start/:txid', async (req, res) => {
  try {
    const { txid } = req.params;
    const jobId = `kenny-${txid}-${Date.now()}`;
    
    console.log(`🔄 [KENNY-START] Starting Kenny job ${jobId} for txid: ${txid}`);
    
    // Check if already cached
    if (kennyProofCache.has(txid)) {
      console.log(`✅ [KENNY-START] Found cached result for txid: ${txid}`);
      return res.json({
        jobId,
        status: 'completed',
        result: kennyProofCache.get(txid)
      });
    }
    
    // Check if already processing
    if (ongoingKennyRequests.has(txid)) {
      console.log(`⏳ [KENNY-START] Already processing txid: ${txid}`);
      return res.json({
        jobId: `existing-${txid}`,
        status: 'processing'
      });
    }
    
    // Start new job
    kennyJobs.set(jobId, {
      status: 'processing',
      startTime: Date.now()
    });
    
    // Start processing in background (don't await)
    const kennyPromise = processKennyRequest(txid);
    ongoingKennyRequests.set(txid, kennyPromise);
    
    // Handle completion/failure in background
    kennyPromise
      .then(result => {
        kennyProofCache.set(txid, result);
        kennyJobs.set(jobId, {
          status: 'completed',
          result,
          startTime: kennyJobs.get(jobId)?.startTime || Date.now()
        });
        console.log(`✅ [KENNY-JOB] Job ${jobId} completed`);
      })
      .catch(error => {
        kennyJobs.set(jobId, {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
          startTime: kennyJobs.get(jobId)?.startTime || Date.now()
        });
        console.error(`❌ [KENNY-JOB] Job ${jobId} failed:`, error);
      })
      .finally(() => {
        ongoingKennyRequests.delete(txid);
      });
    
    // Return immediately
    res.json({
      jobId,
      status: 'processing',
      message: 'Kenny processing started'
    });
    
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Check job status
app.get('/api/proof-kenny-status/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    
    const job = kennyJobs.get(jobId);
    if (!job) {
      return res.status(404).json({
        error: 'Job not found',
        jobId
      });
    }
    
    const runtime = Math.round((Date.now() - job.startTime) / 1000);
    
    res.json({
      jobId,
      status: job.status,
      runtime: `${runtime} seconds`,
      result: job.result,
      error: job.error
    });
    
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

app.get('/api/proof-kenny/:txid', async (req, res) => {
  try {
    const { txid } = req.params;
    const apiKey = req.headers['x-api-key'] as string;
    
    console.log(`🔍 [KENNY] Processing request for txid: ${txid}`);
    
    // STEP 1: RATE LIMITING (optional but recommended)
    const now = Date.now();
    const rateLimitKey = `${apiKey}-kenny`;
    const currentUsage = kennyRequestTracker.get(rateLimitKey);
    
    if (currentUsage) {
      if (now < currentUsage.resetTime) {
        if (currentUsage.count >= KENNY_RATE_LIMIT) {
          return res.status(429).json({
            error: 'Rate limit exceeded for Kenny endpoint. Max 5 requests per hour.',
            retryAfter: Math.ceil((currentUsage.resetTime - now) / 1000)
          });
        }
        currentUsage.count++;
      } else {
        kennyRequestTracker.set(rateLimitKey, { count: 1, resetTime: now + KENNY_RATE_WINDOW });
      }
    } else {
      kennyRequestTracker.set(rateLimitKey, { count: 1, resetTime: now + KENNY_RATE_WINDOW });
    }
    
    console.log(`🔍 [KENNY] Rate limit check passed (${kennyRequestTracker.get(rateLimitKey)?.count}/${KENNY_RATE_LIMIT})`);
    
    // STEP 2: CHECK CACHE FIRST
    if (kennyProofCache.has(txid)) {
      console.log(`✅ [CACHE] Found cached Kenny proof for txid: ${txid}`);
      return res.json(kennyProofCache.get(txid));
    }
    
    // STEP 3: CHECK IF ALREADY PROCESSING
    if (ongoingKennyRequests.has(txid)) {
      console.log(`⏳ [QUEUE] Kenny request already in progress for txid: ${txid}, waiting for result...`);
      try {
        const result = await ongoingKennyRequests.get(txid);
        return res.json(result);
      } catch (error) {
        return res.status(500).json({ 
          error: error instanceof Error ? error.message : 'Unknown error',
          txid: txid
        });
      }
    }
    
    // STEP 4: START NEW KENNY PROCESSING
    console.log(`🔄 [KENNY] Starting new Kenny request for txid: ${txid}`);
    
    const kennyPromise = processKennyRequest(txid);
    ongoingKennyRequests.set(txid, kennyPromise);
    
    try {
      const result = await kennyPromise;
      
      // CACHE THE RESULT (proof data never changes for confirmed transactions)
      kennyProofCache.set(txid, result);
      console.log(`✅ [CACHE] Cached Kenny proof for txid: ${txid}`);
      
      res.json(result);
      
    } catch (error) {
      console.error('❌ [KENNY] Kenny processing failed:', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        txid: txid,
        timestamp: new Date().toISOString()
      });
    } finally {
      // Clean up ongoing request tracker
      ongoingKennyRequests.delete(txid);
    }
    
  } catch (error) {
    console.error('❌ [KENNY] Unexpected error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      txid: req.params.txid,
      timestamp: new Date().toISOString()
    });
  }
});

// Check Kenny status by txid (cleaner for cron jobs)
app.get('/api/proof-kenny-status-by-txid/:txid', async (req, res) => {
  try {
    const { txid } = req.params;
    
    console.log(`🔍 [KENNY-STATUS] Checking status for txid: ${txid}`);
    
    // Check if cached (completed)
    if (kennyProofCache.has(txid)) {
      return res.json({
        txid,
        status: 'completed',
        result: kennyProofCache.get(txid),
        message: 'Found in cache'
      });
    }
    
    // Check if currently processing
    if (ongoingKennyRequests.has(txid)) {
      return res.json({
        txid,
        status: 'processing',
        message: 'Currently being processed'
      });
    }
    
    // Not found - either never started or failed
    return res.json({
      txid,
      status: 'not_found',
      message: 'No Kenny job found for this txid'
    });
    
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
      txid: req.params.txid
    });
  }
});

// Helper function to split Kenny's hex strings into 32-byte chunks
function splitIntoChunks(hexString: string): string[] {
  if (!hexString || typeof hexString !== 'string') {
    return Array(14).fill('0'.repeat(64)); // 14 empty 32-byte chunks
  }
  
  // Remove 0x prefix if present
  const cleanHex = hexString.startsWith('0x') ? hexString.slice(2) : hexString;
  
  // Split into 64-character chunks (32 bytes each)
  const chunks: string[] = [];
  for (let i = 0; i < cleanHex.length; i += 64) {
    const chunk = cleanHex.slice(i, i + 64);
    if (chunk.length === 64) {
      chunks.push(chunk);
    }
  }
  
  // Ensure exactly 14 chunks (pad if needed)
  while (chunks.length < 14) {
    chunks.push('0'.repeat(64));
  }
  
  console.log(`🔧 [KENNY-FIX] Split ${cleanHex.length} chars into ${chunks.length} chunks`);
  return chunks.slice(0, 14);
}

function extractWitnessCommitment(coinbaseTxHex: string): string | null {
  try {
    console.log("🔍 [WITNESS-EXTRACT] Extracting witness commitment from coinbase...");
    console.log("🔍 [WITNESS-EXTRACT] Coinbase hex length:", coinbaseTxHex.length);
    
    // Look for the witness commitment pattern in the coinbase transaction
    // Witness commitment is in an OP_RETURN output with prefix aa21a9ed
    const commitmentPattern = /aa21a9ed([0-9a-fA-F]{64})/;
    const match = coinbaseTxHex.match(commitmentPattern);
    
    if (match && match[1]) {
      const witnessCommitment = match[1];
      console.log("✅ [WITNESS-EXTRACT] Found witness commitment:", witnessCommitment);
      return witnessCommitment;
    }
    
    console.log("❌ [WITNESS-EXTRACT] No witness commitment found in coinbase");
    return null;
  } catch (error) {
    console.error("❌ [WITNESS-EXTRACT] Error extracting witness commitment:", error);
    return null;
  }
}

// Add these type definitions at the top of your server.ts file

// Type for parsed transaction structure
interface ParsedTransaction {
  version: string;
  ins: Array<{
    outpoint: {
      hash: string;
      index: string;
    };
    scriptSig: string;
    sequence: string;
  }>;
  outs: Array<{
    value: string;
    scriptPubKey: string;
  }>;
  locktime: string;
}

// Type for parsed transaction data result
interface ParsedTransactionData {
  wtx: ParsedTransaction;
  witnessData: string;
}

// Type for Kenny's proof result - make it flexible
interface KennyProofResult {
  blockHeight: number;
  transaction: string;
  blockHeader: string;
  txIndex: number;
  merkleProofDepth: number;
  witnessMerkleProof: string;
  witnessReservedValue: string;
  coinbaseTransaction: string;
  coinbaseMerkleProof: string;
  [key: string]: any; // Allow additional properties for flexible access
}

// Fixed parseKennyTransactionData function with proper typing
function parseKennyTransactionData(combinedTxHex: string): ParsedTransactionData {
  console.log("🔧 [TX-PARSER] Parsing Kenny's combined transaction data");
  console.log("🔧 [TX-PARSER] Input length:", combinedTxHex.length);
  
  // Remove 0x prefix if present
  const cleanHex = combinedTxHex.startsWith('0x') ? combinedTxHex.slice(2) : combinedTxHex;
  
  let offset = 0;
  
  // Parse version (4 bytes)
  const version = cleanHex.slice(offset, offset + 8);
  offset += 8;
  
  // Check for SegWit marker and flag
  const marker = cleanHex.slice(offset, offset + 2);
  const flag = cleanHex.slice(offset + 2, offset + 4);
  const isSegwit = marker === "00" && flag === "01";
  
  if (isSegwit) {
    console.log("✅ [TX-PARSER] Detected SegWit transaction");
    offset += 4; // Skip marker and flag
  }
  
  // Parse input count
  const inputCount = parseInt(cleanHex.slice(offset, offset + 2), 16);
  offset += 2;
  console.log("📋 [TX-PARSER] Input count:", inputCount);
  
  // Parse inputs
  const inputs: ParsedTransaction['ins'] = [];
  for (let i = 0; i < inputCount; i++) {
    // Previous output hash (32 bytes = 64 hex chars)
    const prevHash = cleanHex.slice(offset, offset + 64);
    offset += 64;
    
    // Previous output index (4 bytes = 8 hex chars)
    const prevIndex = cleanHex.slice(offset, offset + 8);
    offset += 8;
    
    // Script length (1 byte = 2 hex chars, assuming < 253)
    const scriptLen = parseInt(cleanHex.slice(offset, offset + 2), 16);
    offset += 2;
    
    // Script data
    const script = cleanHex.slice(offset, offset + (scriptLen * 2));
    offset += (scriptLen * 2);
    
    // Sequence (4 bytes = 8 hex chars)
    const sequence = cleanHex.slice(offset, offset + 8);
    offset += 8;
    
    inputs.push({
      outpoint: {
        hash: `0x${prevHash}`,
        index: `0x${prevIndex}`
      },
      scriptSig: `0x${script}`,
      sequence: `0x${sequence}`
    });
  }
  
  // Parse output count
  const outputCount = parseInt(cleanHex.slice(offset, offset + 2), 16);
  offset += 2;
  console.log("📋 [TX-PARSER] Output count:", outputCount);
  
  // Parse outputs
  const outputs: ParsedTransaction['outs'] = [];
  for (let i = 0; i < outputCount; i++) {
    // Value (8 bytes = 16 hex chars)
    const value = cleanHex.slice(offset, offset + 16);
    offset += 16;
    
    // Script length
    const scriptLen = parseInt(cleanHex.slice(offset, offset + 2), 16);
    offset += 2;
    
    // Script data
    const script = cleanHex.slice(offset, offset + (scriptLen * 2));
    offset += (scriptLen * 2);
    
    outputs.push({
      value: `0x${value}`,
      scriptPubKey: `0x${script}`
    });
  }
  
  // Extract witness data (if SegWit)
  let witnessData = "0x";
  let locktime = "0x00000000";
  
  if (isSegwit && offset < cleanHex.length - 8) {
    // Everything between outputs and locktime is witness data
    const witnessStart = offset;
    const witnessEnd = cleanHex.length - 8; // Locktime is last 8 chars
    
    witnessData = `0x${cleanHex.slice(witnessStart, witnessEnd)}`;
    locktime = `0x${cleanHex.slice(-8)}`;
    
    console.log("✅ [TX-PARSER] Extracted witness data length:", witnessData.length - 2);
  } else {
    // Non-SegWit transaction
    locktime = `0x${cleanHex.slice(-8)}`;
  }
  
  const parsedTx: ParsedTransaction = {
    version: `0x${version}`,
    ins: inputs,
    outs: outputs,
    locktime: locktime
  };
  
  console.log("✅ [TX-PARSER] Successfully parsed transaction");
  console.log("📋 [TX-PARSER] Structure:", {
    version: parsedTx.version,
    inputCount: parsedTx.ins.length,
    outputCount: parsedTx.outs.length,
    locktime: parsedTx.locktime,
    witnessDataLength: witnessData.length - 2
  });
  
  return {
    wtx: parsedTx,
    witnessData: witnessData
  };
}

// Fixed processKennyRequest function with proper typing
async function processKennyRequest(txid: string): Promise<any> {
  let blockHash = '';
  
  // Import Kenny's tool
  const { bitcoinTxProof } = await import('bitcoin-tx-proof');
  
  // Get transaction info to find blockhash
  try {
    console.log("🔄 [KENNY] Getting transaction info...");
    
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
    const txInfo = JSON.parse(rawResponse);
    
    if (txInfo.result && txInfo.result.blockhash) {
      blockHash = txInfo.result.blockhash;
      console.log(`✅ [KENNY] Found blockhash: ${blockHash}`);
    } else {
      throw new Error("Transaction not confirmed or not found");
    }
  } catch (error) {
    throw new Error(`Failed to get transaction info: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }

  // Get block height from block hash
  let blockHeight: number;
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
      console.log(`✅ [KENNY] Found block height: ${blockHeight}`);
    } else {
      throw new Error("Could not get block height");
    }
  } catch (error) {
    throw new Error(`Failed to get block height: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
  
  console.log(`🎯 [KENNY] Using Kenny's tool with txid: ${txid}, blockHeight: ${blockHeight}`);
  
  // Configure Kenny's RPC parameters
  const btcRPCConfig = {
    url: `http://${process.env.RPC_HOST || 'localhost'}:${process.env.RPC_PORT || '8332'}`,
    username: process.env.RPC_USER || '',
    password: process.env.RPC_PASS || ''
  };
  
  // Use Kenny's bitcoinTxProof function - cast to our flexible type
  console.log(`🔄 [KENNY] Calling Kenny's bitcoinTxProof...`);
  const proof = await bitcoinTxProof(txid, blockHeight, btcRPCConfig) as KennyProofResult;
  
  console.log("✅ [KENNY] Kenny's bitcoinTxProof completed successfully");
  
  // 🔍 COMPLETE ANALYSIS OF KENNY'S OUTPUT
  console.log("================================================================================");
  console.log("🔍 [KENNY-COMPLETE-ANALYSIS] FULL KENNY OUTPUT ANALYSIS");
  console.log("================================================================================");
  
  // 1. Show ALL keys Kenny returns
  console.log("📋 [KENNY-ANALYSIS] All keys returned by Kenny:");
  Object.keys(proof).forEach(key => {
    const value = (proof as any)[key]; // Use any for dynamic property access
    console.log(`   - ${key}: ${typeof value} (length: ${value?.length || 'N/A'})`);
  });
  
  // 2. Detailed analysis of each field
  console.log("\n📊 [KENNY-ANALYSIS] Detailed field analysis:");
  Object.keys(proof).forEach(key => {
    const value = (proof as any)[key]; // Use any for dynamic property access
    const analysis = {
      key,
      type: typeof value,
      length: value?.length,
      isString: typeof value === 'string',
      isArray: Array.isArray(value),
      isEmpty: !value || value === '',
      isAllZeros: value === '0000000000000000000000000000000000000000000000000000000000000000',
      preview: typeof value === 'string' ? value.slice(0, 64) + (value.length > 64 ? '...' : '') : value
    };
    console.log(`   ${key}:`, JSON.stringify(analysis, null, 4));
  });
  
  // 3. WITNESS-SPECIFIC ANALYSIS
  console.log("\n🎯 [KENNY-ANALYSIS] WITNESS MERKLE ROOT INVESTIGATION:");
  const witnessFields = [
    'witnessReservedValue', 
    'witnessMerkleRoot', 
    'witnessCommitment', 
    'wtxidRoot', 
    'computedWtxidRoot',
    'witnessRoot',
    'merkleRoot'
  ];
  
  witnessFields.forEach(field => {
    const fieldValue = (proof as any)[field]; // Use any for dynamic property access
    if (fieldValue !== undefined) {
      const isAllZeros = fieldValue === '0000000000000000000000000000000000000000000000000000000000000000';
      const isEmpty = !fieldValue || fieldValue === '';
      console.log(`   ✅ FOUND ${field}:`);
      console.log(`      Value: ${fieldValue}`);
      console.log(`      Type: ${typeof fieldValue}`);
      console.log(`      Length: ${fieldValue?.length}`);
      console.log(`      Is all zeros: ${isAllZeros}`);
      console.log(`      Is empty: ${isEmpty}`);
      console.log(`      VIABLE FOR WITNESS ROOT: ${!isAllZeros && !isEmpty ? 'YES ✅' : 'NO ❌'}`);
    } else {
      console.log(`   ❌ ${field}: NOT FOUND`);
    }
  });
  
  // 4. DETERMINE THE CORRECT WITNESS ROOT
  console.log("\n🎯 [KENNY-ANALYSIS] WITNESS ROOT SELECTION:");
  let selectedWitnessRoot: string | null = null;
  let selectedField: string | null = null;
  
  // Priority order for witness root selection
  const priorityOrder = ['witnessMerkleRoot', 'computedWtxidRoot', 'wtxidRoot', 'witnessRoot', 'witnessCommitment', 'witnessReservedValue'];
  
  for (const field of priorityOrder) {
    const fieldValue = (proof as any)[field]; // Use any for dynamic property access
    if (fieldValue && fieldValue !== '0000000000000000000000000000000000000000000000000000000000000000' && fieldValue !== '') {
      selectedWitnessRoot = fieldValue;
      selectedField = field;
      break;
    }
  }
  
  console.log(`   Selected witness root field: ${selectedField || 'NONE FOUND'}`);
  console.log(`   Selected witness root value: ${selectedWitnessRoot || 'ALL ZEROS/EMPTY'}`);
  
  if (!selectedWitnessRoot) {
    console.log("   ⚠️  WARNING: No valid witness root found! Using witnessReservedValue as fallback");
    selectedWitnessRoot = proof.witnessReservedValue || '0000000000000000000000000000000000000000000000000000000000000000';
    selectedField = 'witnessReservedValue (fallback)';
  }
  
  // 5. FINAL PROOF CONSTRUCTION WITH WITNESS ROOT EXTRACTION
  console.log("\n🏗️  [KENNY-ANALYSIS] CONSTRUCTING FINAL PROOF:");

  // Try to extract witness commitment from coinbase transaction
  let witnessRoot = selectedWitnessRoot;
  if (!witnessRoot || witnessRoot === '0000000000000000000000000000000000000000000000000000000000000000') {
    console.log("🔍 [KENNY-ANALYSIS] Attempting to extract witness commitment from coinbase...");
    const extractedCommitment = extractWitnessCommitment(proof.coinbaseTransaction);
    if (extractedCommitment) {
      witnessRoot = extractedCommitment;
      selectedField = 'coinbase witness commitment';
      console.log("✅ [KENNY-ANALYSIS] Using extracted witness commitment as witness root");
    }
  }

  // 🔧 PARSE KENNY'S COMBINED TRANSACTION DATA
  console.log("🔧 [KENNY-ANALYSIS] Parsing transaction data...");
  const { wtx, witnessData } = parseKennyTransactionData(proof.transaction);

  const formattedProof = {
    segwit: true,
    height: proof.blockHeight,
    header: proof.blockHeader,
    txIndex: proof.txIndex,
    treeDepth: proof.merkleProofDepth,
    wproof: splitIntoChunks(proof.witnessMerkleProof),
    computedWtxidRoot: witnessRoot || '0000000000000000000000000000000000000000000000000000000000000000',
    ctxHex: proof.coinbaseTransaction,
    cproof: splitIntoChunks(proof.coinbaseMerkleProof),
    
    // 🔧 ADD THE PARSED TRANSACTION STRUCTURE AND WITNESS DATA
    wtx: wtx,
    witnessData: witnessData
  };

  console.log(`   Final computedWtxidRoot: ${formattedProof.computedWtxidRoot}`);
  console.log(`   Source field: ${selectedField}`);
  console.log(`   Is all zeros: ${formattedProof.computedWtxidRoot === '0000000000000000000000000000000000000000000000000000000000000000'}`);

  if (formattedProof.computedWtxidRoot === '0000000000000000000000000000000000000000000000000000000000000000') {
    console.log("⚠️  [KENNY-ANALYSIS] WARNING: Still using all-zeros witness root - Clarity verification may fail");
  } else {
    console.log("✅ [KENNY-ANALYSIS] SUCCESS: Found valid witness root - Clarity verification should pass");
  }
  
  console.log("================================================================================");
  console.log("🎉 [KENNY-ANALYSIS] ANALYSIS COMPLETE - RETURNING PROOF");
  console.log("================================================================================");
  
  return formattedProof;
}

// Add a cache clearing endpoint for testing
app.delete('/api/proof-kenny-cache/:txid', async (req, res) => {
  try {
    const { txid } = req.params;
    
    // Clear from cache
    kennyProofCache.delete(txid);
    
    // Clear from ongoing requests
    ongoingKennyRequests.delete(txid);
    
    console.log(`🗑️ [CACHE] Cleared cache for txid: ${txid}`);
    
    res.json({
      message: `Cache cleared for txid: ${txid}`,
      txid
    });
    
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Or clear all cache
app.delete('/api/proof-kenny-cache-all', async (req, res) => {
  try {
    kennyProofCache.clear();
    ongoingKennyRequests.clear();
    kennyJobs.clear();
    
    console.log(`🗑️ [CACHE] Cleared all Kenny caches`);
    
    res.json({
      message: "All Kenny caches cleared"
    });
    
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Bitcoin proof service running on port ${PORT}`);
  console.log(`RPC host: ${process.env.RPC_HOST || 'localhost'}`);
});