# Bitcoin Proof Service

A robust Bitcoin transaction proof generation service that creates cryptographic proofs for Bitcoin transactions to be verified on the Stacks blockchain.

## 🎯 High-Level Goal

This service enables **cross-chain verification** by generating cryptographic proofs that a specific Bitcoin transaction exists and was confirmed in a Bitcoin block. These proofs can then be verified on the Stacks blockchain using Clarity smart contracts, enabling trustless Bitcoin-to-Stacks bridges and other cross-chain applications.

## 🏗️ Architecture Overview

The service uses a **hybrid approach** combining multiple proof generation methods for maximum reliability:

1. **Primary Methods**: Traditional proof generation using `clarity-bitcoin-client` and external APIs
2. **Fallback Method**: Kenny's `bitcoin-tx-proof` library combined with Bitcoin RPC calls (Friedger's method)
3. **Smart Routing**: Automatically falls back to Kenny's method when primary methods encounter specific errors

## 🔄 Complete Flow Diagram

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Client App    │───▶│  BE Client       │───▶│  Proof Service  │
│  (Stacks dApp)  │    │ getBitcoinProof  │    │   (Express)     │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                ▲                        │
                                │                        ▼
                                │               ┌─────────────────┐
                                │               │  Try Primary    │
                                │               │   Methods       │
                                │               │ ┌─────────────┐ │
                                │               │ │ Our Service │ │
                                │               │ │ Mike's API  │ │
                                │               │ └─────────────┘ │
                                │               └─────────────────┘
                                │                        │
                                │                        ▼
                                │               ┌─────────────────┐
                                │               │   If Failed     │
                                │               │ (Unknown version│
                                │               │   errors etc)   │
                                │               └─────────────────┘
                                │                        │
                                │                        ▼
                                │               ┌─────────────────┐
                                │               │ Kenny's Method  │
                                │               │ (Friedger's     │
                                │               │   Approach)     │
                                │               └─────────────────┘
                                │                        │
                                └────────────────────────┘
```

## 🔧 Friedger's Method (Kenny's Fallback)

When primary methods fail, the service uses Friedger's proven approach that combines Kenny's `bitcoin-tx-proof` library with Bitcoin RPC calls:

### Step 1: Get Proof Data from Kenny
```typescript
const proof = await bitcoinTxProof(txid, blockHeight, btcRPCConfig);
```
**What Kenny provides:**
- Merkle proof paths (`witnessMerkleProof`, `coinbaseMerkleProof`)
- Block headers (`blockHeader`)
- Transaction index (`txIndex`)
- Tree depth (`merkleProofDepth`)
- Witness merkle root

### Step 2: Get Transaction Data from Bitcoin RPC
```typescript
const txDetail = await fetch(rpcUrl, {
  method: 'POST',
  body: JSON.stringify({
    method: 'getrawtransaction',
    params: [txid, 1, blockHash] // verbose=1, include blockhash
  })
});
```
**What RPC provides:**
- Complete transaction structure
- Input/output details with proper formatting
- Witness data in `txinwitness` fields

### Step 3: Calculate Witness Data (Friedger's Key Insight)
```typescript
let witnessData = tx.vin.reduce((acc: string, input: any) => {
  if (input.txinwitness) {
    acc += input.txinwitness.join("");
  }
  return acc;
}, "");
```

### Step 4: Format for Stacks/Clarity
Apply standard Stacks byte formatting to the RPC transaction data:
- Reverse byte order for integers
- Convert to proper buffer formats
- Structure as Clarity tuples

## 🚀 API Endpoints

### Regular Proof Generation
```
GET /api/proof/:txid[?blockHash=...]
```
Uses primary methods first, falls back to Kenny if needed.

### Kenny-Specific Endpoints
```
POST /api/proof-kenny-start/:txid    # Start async processing
GET /api/proof-kenny-status/:jobId   # Check job status  
GET /api/proof-kenny/:txid           # Synchronous Kenny proof
```

### Utility Endpoints
```
GET /api/tx/:txid/status             # Transaction confirmation status
GET /api/tx/:txid                    # Full transaction data
GET /api/tx/:txid/hex               # Raw transaction hex
GET /api/bitcoin/fees               # Current fee estimates
GET /api/address/:address/utxo      # UTXO data for address
```

## 🏃‍♂️ Running the Service

### Prerequisites
- Node.js 18+
- Bitcoin Core node (or access to one)
- Environment variables configured

### Environment Variables
```bash
# Bitcoin RPC Configuration
RPC_HOST=your-bitcoin-node-ip
RPC_PORT=8332
RPC_USER=your-rpc-username  
RPC_PASS=your-rpc-password

# API Security
API_KEY=your-secure-api-key

# Service Configuration
PORT=3000
```

### Installation & Startup
```bash
npm install
npm run dev  # Development
npm start    # Production
```

## 🔌 Integration Example

### Backend Integration
```typescript
import { getBitcoinProofData } from './bitcoin-proof-client';

// Generate proof for a Bitcoin transaction
const proofData = await getBitcoinProofData(
  'a54f313f68172ac996c37d36baa885486dfea900cce4debca3fcdea7ea45f64f'
);

// Use in Stacks contract call
const contractCall = {
  contractAddress: 'SP...',
  contractName: 'btc-bridge',
  functionName: 'verify-btc-tx',
  functionArgs: proofData.processArgs
};
```

### Frontend Usage
```typescript
// The service automatically handles method selection
const response = await fetch('/api/proof/YOUR_TXID', {
  headers: {
    'x-api-key': 'your-api-key'
  }
});

const proof = await response.json();
```

## 🛡️ Error Handling & Reliability

### Automatic Fallback Logic
1. **Try primary methods** (our service + Mike's API)
2. **If specific errors occur** (`Unknown version`, `parsedCTx is not defined`, etc.)
3. **Automatically fall back to Kenny's method**
4. **Use polling for async Kenny processing**

### Error Types Handled
- Unknown Bitcoin transaction versions
- Parsing errors in transaction data
- Service unavailability
- Rate limiting
- Network timeouts

### Caching Strategy
- **Regular proofs**: No caching (for speed)
- **Kenny proofs**: Aggressive caching (computationally expensive)
- **Rate limiting**: 5 Kenny requests per hour per API key

## 🔍 Why This Approach Works

### The Problem
Bitcoin transactions have evolved over time with new formats (SegWit, Taproot, etc.). Traditional proof generation libraries sometimes fail on newer transaction types with "Unknown version" errors.

### The Solution (Friedger's Insight)
Instead of trying to parse complex Bitcoin transaction formats in JavaScript:

1. **Let Kenny handle the cryptographic proof generation** (he's good at this)
2. **Let Bitcoin Core handle transaction parsing** (it knows all formats)
3. **Combine the results** for maximum reliability

### Benefits
- ✅ **Handles all Bitcoin transaction types** (including newest formats)
- ✅ **Cryptographically sound proofs** (Kenny's proven library)
- ✅ **Accurate transaction data** (directly from Bitcoin Core)
- ✅ **Automatic fallback** (high availability)
- ✅ **Production tested** (Friedger's method is battle-tested)

## 🤝 Contributing

This service implements Friedger's proven approach for Bitcoin proof generation. When contributing:

1. Maintain the hybrid approach (primary + Kenny fallback)
2. Keep the RPC + Kenny combination intact
3. Test with various Bitcoin transaction types
4. Follow the established error handling patterns

## 📚 References

- [Kenny's bitcoin-tx-proof library](https://www.npmjs.com/package/bitcoin-tx-proof)
- [Stacks Clarity Bitcoin library](https://github.com/mechanismHQ/clarity-bitcoin)
- [Bitcoin RPC API documentation](https://developer.bitcoin.org/reference/rpc/)
- Friedger's implementation guidance (Discord discussions)

---

*This service enables trustless Bitcoin-to-Stacks bridges by providing cryptographically verifiable proofs of Bitcoin transactions.*