import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve caminho relativo ao diretório atual deste arquivo, evitando duplicação de segmentos
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname); // já estamos dentro de data/
const DB_PATH = path.join(DATA_DIR, 'db.json');
let writeQueue = Promise.resolve();

function ensureFile(){
  if(!fs.existsSync(DATA_DIR)){
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if(!fs.existsSync(DB_PATH)){
    fs.writeFileSync(DB_PATH, JSON.stringify({customers:[],tickets:[],events:[]},null,2));
  }
}

function readRaw(){
  ensureFile();
  const raw = fs.readFileSync(DB_PATH, 'utf-8');
  return JSON.parse(raw);
}

export function readDB(){
  return readRaw();
}

export function writeDB(mutator){
  writeQueue = writeQueue.then(()=>{
    const data = readRaw();
    const updated = mutator(data) || data;
    fs.writeFileSync(DB_PATH, JSON.stringify(updated,null,2));
  }).catch(e=>console.error('Write error', e));
  return writeQueue;
}
