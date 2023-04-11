# chatbot-server
this is the backend / server side of my chatbot app
1. written in Node JS run-time, Express framework
3. source msg data is powered by OpenAi API's
4. feteched data is cached by SQLite

to run this local: `npm run server` 
<br />
the front-end client side repo is here: https://github.com/markNZed/chatbot-react-client

We can set the port for the websocket server with environment variable PORT=5000
The client URL can be set with environment variable CLIENT_URL="http://localhost:3000"