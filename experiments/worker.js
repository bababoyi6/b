import { connect } from 'cloudflare:sockets';
import { createWorker } from '../telegram_webproxy.js';
import { createTCPEngine } from './tcp.mjs';

export default createWorker(createTCPEngine(connect), true);
