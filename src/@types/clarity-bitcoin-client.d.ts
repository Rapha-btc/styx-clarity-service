// Create in src/@types/clarity-bitcoin-client.d.ts
declare module 'clarity-bitcoin-client' {
    // From bitcoin.js
    export function getProofDataRecent(index: number, rpcParams: RpcParams): Promise<any>;
    export function getProofData(txid: string, blockhash: string, rpcParams: RpcParams): Promise<any>;
    export function reverseAndEven(txs: string[]): string[];
    export function getProofGenerationData(data: any): any;
    
    // From proof.js
    export function extractProofInfo(pgd: any, data: any): any;
    export function ensureEven(list: any[]): void;
    export function generateMerkleTree(hashes: string[]): string[][];
    export function generateMerkleProof(hash: string, hashes: string[]): { merkleProof: string[], treeDepth: number };
    
    // Common interfaces
    export interface RpcParams {
      rpcHost: string;
      rpcPort: number | string;
      rpcUser: string;
      rpcPass: string;
    }
  }