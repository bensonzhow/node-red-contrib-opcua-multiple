# opcua-zclient 使用指南

opcua-zclient 是一个用于与OPC UA服务器进行通信的客户端工具。
支持不同客户端连接不同服务器，并读取节点数据。

以下是使用opcua-zclient的基本步骤：

## 安装

在使用opcua-zclient之前，需要先进行安装。可以通过以下命令进行安装：

npm install opcua-zclient

## 连接到OPC UA服务器

msg.nodeIds: 需要读取的所有节点的配置

msg.optuaConfig: 连接OPC UA服务器的配置，参考 node-opcua: OPCUAClientOptions

msg.userIdentity: 连接OPC UA服务器的校验信息

## 贡献

如果有任何问题或建议，请提交issue或pull request。

感谢您使用opcua-zclient！
