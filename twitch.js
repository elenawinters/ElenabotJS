// Custom Twitch IRC client written by Elena Winters, 2025.
// Intended for use as a library for a browser based Twitch IRC interface.
// This is a simple client that will trigger mitt events based on Twitch IRC events.

// import mitt from 'mitt';  // Requires https://www.npmjs.com/package/mitt
const mitt = require('mitt');  // Import mitt for event handling.
const WebSocket = require('ws');  // Import WebSocket for WebSocket handling.

// ws and ws_open are from legacy implementations. Basically, they let us restart the WebSocket connection if it dies.
let ws = null;
let ws_open = false;
const SOH = String.fromCharCode(1)  // Start of Header character. It's used to denote if the message is a /me message.
// const params = new URLSearchParams(window.location.search);
const username = "justinfan6910810111097";  // This is the anonymous username we'll use. Decimal representation of "Elena".
const password = "what.why.are.you.looking.at.this?";
const address = "wss://irc-ws.chat.twitch.tv:443";
// const channel = params.get('channel') ? params.get('channel') : 'twitchmedia_qs_10'
const channel = 'twitchmedia_qs_10'
const emitter = mitt()  // Requires https://www.npmjs.com/package/mitt

// badge-info=subscriber/40
// badges=subscriber/36,raging-wolf-helm/1

// I hate parsing stuff. This is better than my python implemenation at least.
function parseIRC(data) {
    const raw = structuredClone(data);
    const result = {};
    let match = null;

    if (match = data.match(/^@([^ ]+) /)) {
        const tags = match[1].split(';');
        result['tags'] = {};
        tags.forEach(tag => {
            const [key, value] = tag.split('=');
            if (key == 'badges' || key == 'badge-info' || key == 'source-badges') {
                result['tags'][key] = {}
                if (value == '') { return; }
                const badges = value.split(',')
                badges.forEach((badge) => {
                    const [badgeKey, badgeValue] = badge.split('/')
                    result['tags'][key][badgeKey] = badgeValue
                })
                return;
            } else if (key == 'emotes') {
                result['tags'][key] = []
                if (value == '') { return; }
                const emotes = value.split('/')
                emotes.forEach((emote) => {
                    const [emoteKey, emoteValue] = emote.split(':')
                    result['tags'][key].push({ id: emoteKey, positions: emoteValue.split(',') })
                })
                return;
            }
            result['tags'][key] = value || null;
        });
        data = data.slice(match[0].length);
        // console.log(data)
    }

    if (match = data.match(/^:([^ ]+) ([^ ]+) ?([^ ]+)?(.*)$/)) {
        // console.log(('here'))
        const [_, server, command, target, _message] = match;
        const message = _message.slice(1);  // Remove the space at the start of the message.
        // result['server'] = server;  // I don't really think there's a need for this to be handled.
        result['command'] = command;
        switch (command) {
            case "CAP":
                let cap = message.slice('ACK'.length + 2).split(' ');
                result['ACK'] = cap;
                break;
                // throw new Error("CAP is not handled in the new way yet.");
                // result['response'] = 'ACK';
                // result['message'] = cap;
                // break;
            case "353":
                let users = message.split(' ');
                users.shift();  // Remove the = sign.
                result['channel'] = users.shift(); // Get the channel name.
                users[0] = users[0].slice(1);
                result['users'] = users;
                break;
            case "JOIN":
            case "PART":
                result['channel'] = target;
                result['user'] = server.split('!')[0];
                break;
            case "PRIVMSG":
                result['channel'] = target;
                result['sender'] = server.split('!')[0];
                result['message'] = message.startsWith(":") ? message.slice(1) : message;
                result['action'] = false;
                if (result['message'].includes(SOH)) {
                    result['message'] = result['message'].replace(SOH + 'ACTION', '').replace(SOH, '');
                    result['action'] = true;
                }
                break;
            case "USERNOTICE":  // While this could maybe be under PRIVMSG, it's better to seperate it.
                result['channel'] = target;
                result['sender'] = result['tags']['login'];
                result['message'] = message.startsWith(":") ? message.slice(1) : message;
                result['type'] = result['tags']['msg-id'];
                if (result['message'].includes(SOH)) { console.warn("ACTION DETECTED IN USERNOTICE?! NANI?!") }
                break;
            case "CLEARMSG":
                result['channel'] = target;
                result['user'] = result['tags']['login'];
                result['message'] = message.startsWith(":") ? message.slice(1) : message;
                break;
            case "CLEARCHAT":
                result['channel'] = target;
                result['user'] = message.startsWith(":") ? message.slice(1) : message;
                break;
            default:
                if (/^\d+$/.test(command)) {
                    result['message'] = message.startsWith(":") ? message.slice(1) : message;
                } else {
                    result['channel'] = target;
                    if (message != '') { result['message'] = message.startsWith(":") ? message.slice(1) : message; }
                    if (!['ROOMSTATE', 'GLOBALUSERSTATE'].includes(command)) {
                        console.warn(`${command} is not handled in a special way.`);
                        result['server'] = server;
                    }
                }
        }
    }

    // We add the raw at the end so that it doesn't appear first in the object.
    result['raw'] = raw;
    return result;
}

emitter.on('376', () => {
    console.log(`Joining #${channel}`)
    ws.send(`JOIN #${channel}`);
})

// RECONNECT. If Twitch sends this, we are to disconnect and reconnect immediately.
emitter.on('RECONNECT', () => {
    ws.close()
    setTimeout(() => {
        runWSClient()
    }, 250)
})

runWSClient()  // call this function if the websocket connection dies for any reason.
function runWSClient() {
	if (ws_open == true) { return; }
	ws = new WebSocket(address);

	ws.onopen = async () => {
		ws_open = true
		console.log('Connected')
        if (ws_open == false) { return; }
        ws.send("CAP REQ :twitch.tv/membership twitch.tv/tags twitch.tv/commands");
        ws.send(`PASS ${password}`);
        ws.send(`NICK ${username}`);
	}
	
	ws.onmessage = async (event) => {
        const pre = event.data.split('\r\n')
        pre.forEach((line) => {
            if (line == '') { return; }
            if (line == 'PING :tmi.twitch.tv') {
                ws.send('PONG :tmi.twitch.tv');
                return;  // ^ This is an abnormal format, so we handle it here.
            }
            const comp = parseIRC(line)
            if (comp['command'] == undefined) { return; }
            emitter.emit(comp['command'], comp)
        })
	}

	ws.onclose = (e) => {
		ws_open = false
		delete ws
		console.warn("We've been disconnected.")
        if (e['wasClean'] == true) { return; }
        // Twitch never closes the connection cleanly ever, so this will just always display. The check is unnecessary.
        console.warn("This disconnect doesn't appear to have been intentional, as the connection was not closed cleanly.")
        console.warn(e)
	}
}

// Example that logs all events to the console.
emitter.on('*', (event, data) => {
    console.log(data)
})
