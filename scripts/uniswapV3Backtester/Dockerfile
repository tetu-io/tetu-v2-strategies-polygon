# syntax=docker/dockerfile:1
FROM node
WORKDIR /app
RUN git clone https://github.com/tetu-io/tetu-v2-strategies-polygon.git .
RUN git checkout alien-dev
RUN npm i
ENV TETU_HARDHAT_CHAIN_ID=31337
RUN npx hardhat compile
RUN apt-get update
RUN apt-get install systemctl -y
CMD /usr/local/bin/npx hardhat run scripts/uniswapV3Backtester/backtester.ts
