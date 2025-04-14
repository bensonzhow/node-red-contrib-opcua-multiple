module.exports = function (RED) {
    "use strict";
    let chalk = require("chalk");
    let opcua = require('node-opcua');
    let opcuaBasics = require('./opcua-basics');
    let crypto_utils = opcua.crypto_utils;
    let fileTransfer = require("node-opcua-file-transfer");
    let async = require("async");
    let fs = require("fs");
    let os = require("os");
    let cloneDeep = require('lodash.clonedeep');
    let DataType = opcua.DataType;
    let AttributeIds = opcua.AttributeIds;
    let TimestampsToReturn = opcua.TimestampsToReturn;

    const { createClientCertificateManager } = require("./utils");
    function opcuaZclient(n) {
        RED.nodes.createNode(this, n);

        this.name = n.name;
        let node = this;

        //客户端存储
        let zclients = {};
        let zsessions = {};


        let zlog = {
            error: function (msg) {
                console.log("zlog:", msg);
                node.error(chalk.red(msg));
            },
            warn: function (msg) {
                console.log("zlog:", msg);
                node.warn(chalk.yellow(msg));
            },
            log: function (msg) {
                console.log("zlog:", msg);
                node.log(chalk.blue(msg));
            }
        }
        function zclientOutput(o1 = null, o2 = null, o3 = null) {
            node.send([o1, o2, o3]);
        }
        function createClient(msg) {
            let defaultOptions = {
                endpointUrl: "opc.tcp://0.0.0.0:4840",
                // securityMode: opcua.MessageSecurityMode.None,
                // securityPolicy: opcua.MessageSecurityMode.None,
                endpointMustExist: false,
                defaultSecureTokenLifetime: 40000 * 5,
                connectionStrategy: {
                    maxRetry: 10512000, // Limited to max 10 ~5min // 10512000, // 10 years should be enough. No infinite parameter for backoff.
                    initialDelay: 5000, // 5s
                    maxDelay: 30 * 1000 // 30s
                },
                clientName: "clientName", // Fix for #664 sessionName
                keepSessionAlive: true,
                requestedSessionTimeout: 60000 * 5, // 5min, default 1min
                automaticallyAcceptUnknownCertificate: true,
                // transportSettings: transportSettings // Some 
            };

            let opts = Object.assign({}, defaultOptions, msg.optuaConfig);
            if (opts.endpointUrl.indexOf("opc.tcp://0.0.0.0") === 0) {
                zlog.error("Error: endpointUrl is not set");
                return;
            }
            if (zclients[opts.endpointUrl]) {
                // zlog.warn(`warn: opts.endpointUrl } client already exists`);
                readMultiple(opts.endpointUrl, msg);
                return;
            }
            let client = null;
            try {
                client = opcua.OPCUAClient.create(opts);
                zclients[opts.endpointUrl] = client;
                initClientEvent(client);
                zlog.log(`${opts.endpointUrl} Client created`);
                connectClient(client, opts, msg);
            } catch (error) {
                zlog.error("Error creating OPCUA client: " + error.message);
            }
            return client;
        }
        function connectClient(client, opts, msg) {
            const userIdentity = Object.assign(
                { type: opcua.UserTokenType.Anonymous },
                msg.userIdentity
            );
            client.connect(opts.endpointUrl, function (err) {
                if (err) {
                    zlog.error("Error connecting to OPC UA server: " + err.message);
                    return;
                }
                zlog.log("Connected to OPC UA server");
                //创建会话
                client.createSession(userIdentity, function (err, session) {
                    if (err) {
                        zlog.error("Error creating OPC UA session: " + err.message);
                        return;
                    }
                    zsessions[opts.endpointUrl] = session;
                    zlog.log("Session created");
                    // Read multiple, payload contains all nodeIds that will be read
                    readMultiple(opts.endpointUrl, msg);

                });
            });
        }

        function readMultiple(endpointUrl, msg) {
            zlog.log("Reading multiple nodes");
            if (!msg.nodeIds || msg.nodeIds.length == 0) {
                zlog.error("Error: No nodeIds found in msg");
                return;
            }
            let nodeIds = msg.nodeIds;
            let session = zsessions[endpointUrl];
            if (!session) {
                zlog.error("Error: No session found for endpointUrl: " + endpointUrl);
                return;
            }
            let nodesToRead = nodeIds.map((nodeId) => ({
                nodeId: nodeId,
                attributeId: AttributeIds.Value,
                TimestampsToReturn: opcua.TimestampsToReturn.Both
            }));
            session.read(nodesToRead, function (err, dataValues, diagnostics) {
                if (err) {
                    if (diagnostics) {
                        zlog.error("Error reading nodes diagnostics: " + diagnostics);
                    }
                    zlog.error("Error reading nodes: " + err.message);
                    let payload = {
                        error: err.message,
                        endpoint: endpointUrl,
                    }
                    zclientOutput(null, copyNewMsg(msg,payload), null);
                    return;
                }
                for (let i = 0; i < dataValues.length; i++) {
                    let dataValue = dataValues[i];
                    if (dataValue) {
                        try {
                            let serverTs = dataValue.serverTimestamp;
                            let sourceTs = dataValue.sourceTimestamp;
                            if (serverTs === null) {
                                serverTs = new Date();
                            }
                            if (sourceTs === null) {
                                sourceTs = new Date();
                            }
                            let value = dataValue.value.dataType === opcua.DataType.ExtensionObject
                                ? JSON.parse(JSON.stringify(dataValue.value.value))
                                : dataValue.value.value;
                            let payload = {
                                nodeId: nodeIds[i],
                                value: value,
                                statusCode: dataValue.statusCode,
                                serverTimestamp: serverTs,
                                sourceTimestamp: sourceTs
                            };
                            zclientOutput(copyNewMsg(msg,payload), null, null);
                        } catch (error) {
                            let payload = {
                                error: error.message,
                                endpoint: endpointUrl,
                            }
                            zclientOutput(null, copyNewMsg(msg,payload), null);
                            return;
                        }
                    }
                };
                zlog.log("Read multiple nodes successfully");
                msg.payload = dataValues;
                zclientOutput(null, null, msg);
            });
        }
        function copyNewMsg(msg,payload) {
            let newMsg = cloneDeep(msg);
            newMsg.payload = payload;
            return newMsg;
        }
        function initClientEvent(client) {
            //当初始连接成功时触发此事件。
            client.on("connected", function () {
                zlog.log("Client connected to OPC UA server");
            })
            client.on("connection_failed", function (err) {
                zlog.error("Client connection failed: " + err.message);
            });
            client.on("start_reconnection", function () {
                zlog.log("Client start reconnection");
            });

            client.on("connection_lost", function (err) {
                zlog.error("Client connection lost: " + err.message);
            });
            client.on("backoff", function (retry, delay) {
                zlog.log("Client backoff: retry=" + retry + ", delay=" + delay);
            });
            client.on("closed", function () {
                zlog.log("Client closed");
            });
            client.on("abort", function () {
                zlog.log("Client abort");
            });
            client.on("connection_reestablished", function () {
                zlog.log("Client connection reestablished");
            });
            client.on("timed_out_request", function (request) {
                zlog.error("Client timed out request: " + request.requestHeader.requestHandle);
            });
        }
        function onInput(msg) {
            if (!msg.optuaConfig || !msg.optuaConfig.endpointUrl) {
                zlog.error("Error: No optuaConfig found in msg or optuaConfig.endpointUrl is empty");
                return;
            }
            createClient(msg);
        }
        function onClose(done) {
            done();
        }
        function onError(msg) {
        }
        node.on("input", onInput);
        node.on("close", onClose);
        node.on("error", onError);


    }
    RED.nodes.registerType("OpcUa-Zclient", opcuaZclient);
}

