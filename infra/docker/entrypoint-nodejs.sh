#!/bin/bash

cd /app/taskflow/nodejsProcessor
npm install
screen -d -m npm start
sleep infinity
