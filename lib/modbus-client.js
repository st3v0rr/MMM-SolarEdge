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

      const onError = (err) => {
        socket.destroy();
        this.teardown(err);
        reject(err);
      };

      socket.once("error", onError);
      socket.connect(this.port, this.host, () => {
        socket.removeListener("error", onError);
        socket.on("error", (err) => this.teardown(err));
        socket.on("close", () =>
          this.teardown(new Error("Modbus connection closed"))
        );
        socket.on("data", (chunk) => this.onData(chunk));
        this.socket = socket;
        this.connecting = null;
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
