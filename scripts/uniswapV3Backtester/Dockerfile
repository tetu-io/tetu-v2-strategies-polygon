# syntax=docker/dockerfile:1
FROM node
WORKDIR /app
RUN git clone https://github.com/tetu-io/tetu-v2-strategies-polygon.git . && git checkout alien-dev && echo '4'
RUN npm i
ENV TETU_HARDHAT_CHAIN_ID=31337
RUN npx hardhat compile
CMD /usr/local/bin/npx cross-env NODE_OPTIONS="--max_old_space_size=3500" hardhat run scripts/uniswapV3Backtester/backtester.ts --max-memory 3500
