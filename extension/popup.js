import { collectYouTube } from './collect.js'
import { OASIS_ORIGIN } from './config.js'
import { oasisUrl } from './handoff.js'

const msg = document.getElementById('msg')
const send = document.getElementById('send')
const withTranscript = document.getElementById('transcript')

const say = (text, error = false) => {
  msg.textContent = text
  msg.className = error ? 'error' : ''
}

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
const onYouTube = tab && /^https:\/\/(www\.|m\.)?youtube\.com\/(watch|shorts\/|live\/)/.test(tab.url || '')
if (!onYouTube) {
  send.disabled = true
  say('Open a video on youtube.com first, then click Send to Oasis.')
}

send.addEventListener('click', async () => {
  send.disabled = true
  say(withTranscript.checked ? 'Reading the video and its transcript…' : 'Reading the video…')
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: collectYouTube,
      args: [{ transcript: withTranscript.checked }],
    })
    const r = res && res.result
    if (!r || !r.ok) {
      say(r && r.reason === 'no_video' ? "This page isn't a single video. Open the video itself, then try again." : "Couldn't read this page. Reload the video and try again.", true)
      send.disabled = false
      return
    }
    await chrome.tabs.create({ url: oasisUrl(OASIS_ORIGIN, r, withTranscript.checked), index: tab.index + 1 })
    window.close()
  } catch (e) {
    say("Couldn't read this page. Reload the video and try again.", true)
    send.disabled = false
  }
})
