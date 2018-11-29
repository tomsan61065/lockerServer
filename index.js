"use strict";

const express = require("express");
const cookieParser = require('cookie-parser'); //處裡 cookie 相關
const bodyParser = require('body-parser'); // 處裡收到的 req 的 body(不同的請求、編碼)
const cors = require('cors'); //cross domain (允許非此domain的人可call API))
const logger = require('morgan'); //日誌功能 子傑沒用到

const app = express();

/**** server configuration ****/
app.use(cookieParser()); //使用 cookieParser
//處理 post 
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true })); // js跟browser encode規則不一樣
app.use(cors());
app.use(logger('dev')); //調用 morgan 的日誌功能 (但在哪邊看的到呢?)

const Web3 = require("web3");

// 連接本地 geth 用ipc (學長推薦的)
//const net = require('net');
//const web3 = new Web3(new Web3.providers.IpcProvider("/home/tom/nccu/nccu/geth.ipc", net));

//const web3 = new Web3('http://localhost:8545');
//  The HTTP provider is deprecated, as it won’t work for subscriptions. 看 web3 說明
// https://medium.com/getamis/%E5%BE%9E-geth-%E5%AE%89%E8%A3%9D%E9%96%8B%E5%A7%8B-%E7%94%A8-golang-%E5%AF%AB%E4%B8%80%E5%80%8B%E4%BB%A5%E5%A4%AA%E5%9D%8A%E7%B4%A2%E5%BC%95%E7%A8%8B%E5%BC%8F-part1-e5004eff260f
// 改用 web socket


// https://stackoverflow.com/questions/51305482/connection-not-open-on-send-error-when-using-websocket-connection-for-kaleid
const web3 = new Web3("ws://localhost:8546");

//=================================
const request = require('request');
const ecies = require("eth-ecies");
const keccak256 = require("js-sha3").keccak256;
const crypto = require("crypto");
const CryptoJS = require("crypto-js");

var timeOut = 10000;


var {
    LockerAbi,
    LockerBin,
} = require("./data/resource");

var lockerContract = new web3.eth.Contract(
    LockerAbi,
    "0xF0B061d189da1E692d13bB3E802d628920D1E255", // <========== locker address 這邊要手動給
);


app.get("/", function(req, res){
    res.send("It works!");
});


function encrypt(publicKey, data) {
    
    let userPublicKey = new Buffer.from(publicKey, 'hex');
    let bufferData = new Buffer(data);
  
    let encryptedData = ecies.encrypt(userPublicKey, bufferData);
  
    return encryptedData.toString('base64')
}

function publicToAddress(pubKey){
    // step 2:  public_key_hash = Keccak-256(public_key)
    const public_key_hash = keccak256(pubKey);

    // step 3:  address = ‘0x’ + last 20 bytes of public_key_hash
    let address = "0x" + public_key_hash.substring(public_key_hash.length - 40, public_key_hash.length);

    return address;
}

function returnIp(req){
    var ip = req.headers['x-forwarded-for'] || 
        req.connection.remoteAddress || 
        req.socket.remoteAddress ||
        (req.connection.socket ? req.connection.socket.remoteAddress : null);
    return ip;
}

var clientList = [];

app.get('/verify_1/:pubKey', async function(req, res){
    let publicKey = req.params.pubKey;
    if(publicKey.length !== 128 && publicKey.length !== 130){
        res.send("eth public key format error");
        return;
    }
    if(publicKey.length == 130){
        publicKey = publicKey.substring(2);
    }
    let address = await publicToAddress(Buffer(publicKey, "hex"));;
    let ip = await returnIp(req);
    let symKey = crypto.randomBytes(256).toString("base64");
    clientList[ip.toString()] = {address, symKey}; //ip 與 對應的 address, symkey
    console.log(ip.toString());
    //console.log(clientList[ip.toString()] );

    // respone 給發起者該 sysKey
    let returnData = await encrypt(publicKey, symKey);
    res.send(returnData);

    setTimeout(function(){ //當開始認證後 就會有 timeout 的限制
        console.log("timeout");
        delete clientList[ip.toString()];
    }, timeOut);
});


app.get('/verify_2/:message(*)', async function(req, res){ // (*) = wildcard
    let ip = await returnIp(req);
    if(clientList[ip.toString()] == null){ //nul == undefiend 但 !== undefiend ...
        res.send("verify_1 require");
        return;
    }
    let data = req.params.message;
    let compareAddress = await CryptoJS.AES.decrypt(data.toString(), clientList[ip.toString()].symKey).toString(CryptoJS.enc.Utf8);
    //console.log("orig:" + clientList[ip.toString()].address);
    //console.log("tran:" + compareAddress);
    if(compareAddress === clientList[ip.toString()].address){
        console.log("true address");

        let returnValue = await lockerContract.methods.openLock(compareAddress).call();
        if(returnValue != 0){
            console.log("Gate of fear.. Open!")
    
            request('http://localhost:8080/unlock', function (error, response, body) { 
                console.log('error:', error); // Print the error if one occurred
                console.log('statusCode:', response && response.statusCode); // Print the response status code if a response was received
                console.log('body:', body); // Print the HTML for the Google homepage.
            });
        }
        res.json({
            returnValue: returnValue,
        });
        
    }else{
        res.send("false");
        console.log("false");
    }
});


//出租 -> 開燈
lockerContract.events.rentLockEvent()
.on('data', function(event){
    console.log("rent");
//    console.log(event); // same results as the optional callback above

    // 看來建議使用 request 
    // https://stackoverflow.com/questions/8515872/simple-api-calls-with-node-js-and-express
    // https://github.com/request/request
    

    request('http://localhost:8080/led/on', function (error, response, body) { 
        console.log('error:', error); // Print the error if one occurred
        console.log('statusCode:', response && response.statusCode); // Print the response status code if a response was received
        console.log('body:', body); // Print the HTML for the Google homepage.
    });

})
.on('changed', function(event){
    // remove event from local database
})
.on('error', console.error);

//歸還 -> 關燈
lockerContract.events.returnLockEvent()
.on('data', function(event){
    console.log("return");
    request('http://localhost:8080/led/off', function (error, response, body) { 
        console.log('error:', error); // Print the error if one occurred
        console.log('statusCode:', response && response.statusCode); // Print the response status code if a response was received
        console.log('body:', body); // Print the HTML for the Google homepage.
    });
})
.on('changed', function(event){
    // remove event from local database
})
.on('error', console.error);


/**** error handlers ****/
// catch 404 and forward to error handler
app.use((req, res, next) => {
    const err = new Error('Not Found');
    err.status = 404;
    next(err);
});
  
if (app.get('env') === 'development') { //功能? process.env相關 pm2-with-watch -> ecosystem.config.js
    app.use((err, req, res, next) => {
        res.status(err.status || 500);
        res.json({
            message: err.message,
            error: err,
        });
    });
}
  
app.use((err, req, res, next) => { // server error
    res.status(err.status || 500);
    res.json({
        message: err.message,
        error: {},
    });
});



app.listen(3000, function(){
    console.log("listen at port 3000");
});