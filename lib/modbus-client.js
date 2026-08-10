/* global Buffer, setTimeout, clearTimeout */
/* MagicMirror²
 * MMM-SolarEdge - minimal Modbus/TCP client
 *
 * Dependency-free implementation of function code 3 (read holding registers).
 * Keeps a single persistent connection, serialises requests and reconnects
 * automatically. Only the parts of the protocol this module needs are covered.
 *
 * By Stefan Nachtrab
 * MIT Licensed.
 */

const net = require("net");

const MBAP_HEADER_LENGTH = 6;
const FC_READ_HOLDING_REGISTERS = 3;
const MAX_REGISTERS_PER_REQUEST = 125;

/* A connection that dies without a FIN is only noticed by the operating system
 * after its own defaults, which are measured in hours. Probing every ten
 * seconds turns a rebooted inverter or an expired NAT entry into a close event
 * within about a minute. */
const KEEPALIVE_DELAY = 10000;

/* A busy follower on the RS485 chain can miss a deadline without the TCP
 * connection being at fault, so a single timeout is tolerated. Two in a row
 * mean nobody is listening any more. */
const MAX_CONSECUTIVE_TIMEOUTS = 2;

class ModbusClient {
  constructor({ host, port = 1502, timeout = 5000 }) {
    this.host = host;
    this.port = port;
    this.timeout = timeout;

    this.socket = null;
    this.connecting = null;
    this.buffer = Buffer.alloc(0);
    this.pending = [];
    this.transactionId = 0;
    this.queue = Promise.resolve();
    this.consecutiveTimeouts = 0;
  }

  connect() {
    if (this.socket && !this.socket.destroyed) {
      return Promise.resolve();
    }
    if (this.connecting) {
      return this.connecting;
    }

    this.connecting = new Promise((resolve, reject) => {
      const socket = new net.Socket();
      socket.setNoDelay(true);
      socket.setKeepAlive(true, KEEPALIVE_DELAY);

      const onError = (err) => {
        socket.destroy();
        this.teardown(err);
        reject(err);
      };

      /* net.Socket has no connect timeout of its own. Without one a host that
       * silently drops SYNs - an inverter that is powered off rather than
       * refusing - would block the queue for the operating system default,
       * which is over two minutes on Linux. */
      const onConnectTimeout = () =>
        onError(
          new Error(
            "Modbus connection to " + this.host + ":" + this.port +
              " timed out"
          )
        );

      socket.once("error", onError);
      socket.once("timeout", onConnectTimeout);
      socket.setTimeout(this.timeout);

      socket.connect(this.port, this.host, () => {
        socket.setTimeout(0);
        socket.removeListener("timeout", onConnectTimeout);
        socket.removeListener("error", onError);
        /* A socket we have already replaced still emits its close event, and
         * it arrives after the next one is up. Without this guard that late
         * event tears down the fresh connection and the reconnect never
         * takes. */
        const ifCurrent = (handler) => (arg) => {
          if (this.socket === socket) {
            handler(arg);
          }
        };
        socket.on("error", ifCurrent((err) => this.teardown(err)));
        socket.on(
          "close",
          ifCurrent(() => this.teardown(new Error("Modbus connection closed")))
        );
        socket.on("data", (chunk) => this.onData(chunk));
        this.socket = socket;
        this.connecting = null;
        this.consecutiveTimeouts = 0;
        resolve();
      });
    }).catch((err) => {
      this.connecting = null;
      throw err;
    });

    return this.connecting;
  }

  /* Rejects everything still in flight and drops the socket so the next
   * request reconnects. */
  teardown(err) {
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    const pending = this.pending;
    this.pending = [];
    pending.forEach((entry) => {
      clearTimeout(entry.timer);
      entry.reject(err);
    });
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= MBAP_HEADER_LENGTH + 1) {
      const length = this.buffer.readUInt16BE(4);
      if (this.buffer.length < MBAP_HEADER_LENGTH + length) {
        return;
      }
      const frame = this.buffer.subarray(0, MBAP_HEADER_LENGTH + length);
      this.buffer = this.buffer.subarray(MBAP_HEADER_LENGTH + length);

      const transactionId = frame.readUInt16BE(0);
      const index = this.pending.findIndex(
        (entry) => entry.transactionId === transactionId
      );
      if (index === -1) {
        continue; // late response of a request that already timed out
      }
      const entry = this.pending.splice(index, 1)[0];
      clearTimeout(entry.timer);
      this.consecutiveTimeouts = 0;

      const functionCode = frame.readUInt8(7);
      if (functionCode & 0x80) {
        entry.reject(
          new Error("Modbus exception code " + frame.readUInt8(8))
        );
        continue;
      }
      const byteCount = frame.readUInt8(8);
      entry.resolve(frame.subarray(9, 9 + byteCount));
    }
  }

  /* A connection can die half open - the inverter reboots, a NAT entry expires
   * - without a close event ever reaching us. The socket then still reports
   * itself as alive, so connect() keeps handing it out and every read
   * disappears into it. Nothing but a run of timeouts gives that away, so that
   * is what forces the reconnect. */
  onTimeout() {
    this.consecutiveTimeouts += 1;
    if (this.consecutiveTimeouts < MAX_CONSECUTIVE_TIMEOUTS) {
      return;
    }
    console.warn(
      "[MMM-SolarEdge] " + this.consecutiveTimeouts + " Modbus reads in a row " +
        "timed out, reconnecting to " + this.host + ":" + this.port
    );
    this.consecutiveTimeouts = 0;
    const socket = this.socket;
    this.teardown(new Error("Modbus connection stopped answering"));
    if (socket) {
      socket.destroy();
    }
  }

  /* Reads count holding registers starting at address (wire address, 0-based).
   * Requests are serialised - the RS485 chain behind the gateway cannot handle
   * overlapping transactions reliably. */
  readHoldingRegisters(unitId, address, count) {
    if (count > MAX_REGISTERS_PER_REQUEST) {
      return Promise.reject(
        new Error(
          "Modbus read of " + count + " registers exceeds the limit of " +
            MAX_REGISTERS_PER_REQUEST
        )
      );
    }

    const run = async () => {
      await this.connect();
      return new Promise((resolve, reject) => {
        this.transactionId = (this.transactionId + 1) & 0xffff;
        const transactionId = this.transactionId;

        const request = Buffer.alloc(12);
        request.writeUInt16BE(transactionId, 0);
        request.writeUInt16BE(0, 2); // protocol identifier
        request.writeUInt16BE(6, 4); // remaining length
        request.writeUInt8(unitId, 6);
        request.writeUInt8(FC_READ_HOLDING_REGISTERS, 7);
        request.writeUInt16BE(address, 8);
        request.writeUInt16BE(count, 10);

        const timer = setTimeout(() => {
          const index = this.pending.findIndex(
            (entry) => entry.transactionId === transactionId
          );
          if (index !== -1) {
            this.pending.splice(index, 1);
          }
          this.onTimeout();
          reject(
            new Error(
              "Modbus read timed out (unit " + unitId + ", address " + address + ")"
            )
          );
        }, this.timeout);

        this.pending.push({ transactionId, resolve, reject, timer });
        this.socket.write(request);
      });
    };

    // chain onto the queue, but never let a rejection break the chain
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  close() {
    if (this.socket) {
      this.socket.destroy();
    }
    this.teardown(new Error("Modbus client closed"));
  }
}

module.exports = ModbusClient;
