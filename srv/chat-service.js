const cds = require('@sap/cds');
const OpenAI = require("openai");
const errorMsg = require("./utils/deepseekErros");

require('dotenv').config();

const openai = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY
});

async function callDeepSeek(payload, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await openai.chat.completions.create(payload);
    } catch (e) {
      /* corpo vazio ou JSON quebrado → SyntaxError */
      const badBody = e instanceof SyntaxError ||
                      e.message?.includes("Unexpected end of JSON");
      if (!badBody) throw e;                    // outros erros: não insista
      console.warn(`[DeepSeek] corpo inválido, tentativa ${i + 1}/${retries}`);
      await new Promise(r => setTimeout(r, (i + 1) * 2000)); // back-off
    }
  }
  /* depois de N tentativas */
  throw new Error("DeepSeek indisponível após várias tentativas");
}

module.exports = cds.service.impl(function (srv) {

  const MAX_CONTEXT = 10;                       // quantas msgs anteriores enviar

  const { Chats, Messages, CsvFiles  } = srv.entities;

  console.log("✅ CAP Service inicializado");

  srv.on('startChat', async req => {
    const { title } = req.data;
    const [chat] = await cds.run(INSERT.into(Chats).entries({ title }));
    return chat;
  });

  srv.on('sendMessage', async req => {
    const chatGuid = typeof req.data.chat === 'string'
        ? req.data.chat : req.data.chat.ID;
    const question = req.data.question;

    await INSERT.into(Messages).entries({
      chat_ID: chatGuid, sender: 'user', text: question
    });

    (async () => {
      try {
        /* 1️⃣ CSV + contexto (igual) */
        const csvRow = await SELECT.one.from(CsvFiles)
                          .where({ chat_ID: chatGuid })
                          .orderBy('createdAt desc');
        const csvText = csvRow?.content || "";

        const prev = await SELECT.from(Messages)
                         .where({ chat_ID: chatGuid })
                         .orderBy('createdAt desc')
                         .limit(MAX_CONTEXT * 2);

        const contextMsgs = prev.reverse().map(m => ({
          role: m.sender === 'user' ? 'user' : 'assistant', content: m.text
        }));

        const baseMsgs = [
          { role: 'system', content: 'Você é um assistente SAP em pt-BR.' },
          ...contextMsgs,
          { role: 'user',
            content: csvText
              ? `Contexto CSV:\n${csvText}\n\nPergunta: ${question}`
              : question }
        ];

        /* 2️⃣ Usa helper com retry */
        const { choices } = await callDeepSeek({
          model      : 'deepseek-chat',
          messages   : baseMsgs,
          max_tokens : 2048
        });

        const answer = choices?.[0]?.message?.content ?? "❔";

        await INSERT.into(Messages).entries({
          chat_ID: chatGuid, sender: 'bot', text: answer
        });
        await UPDATE(Chats, { ID: chatGuid }).with({ lastMessage: answer });
        console.log("[DeepSeek] resposta gravada para chat", chatGuid);

      } catch (e) {
        console.error("[DeepSeek bg] erro:", e);
        const friendly = e.message.includes("indisponível")
              ? "⚠️ DeepSeek está instável. Tente novamente mais tarde."
              : (errorMsg[e?.status] || errorMsg.DEFAULT);

        await INSERT.into(Messages).entries({
          chat_ID: chatGuid, sender: 'bot', text: friendly
        });
        await UPDATE(Chats, { ID: chatGuid }).with({ lastMessage: friendly });
      }
    })();

    return { status: "queued" };
  });

  srv.on('uploadCsv', async req => {
    const { chat, csv } = req.data;
    if (!chat || !csv) return req.error(400, "chat e csv obrigatórios");
    console.log("[uploadCsv] chat:", chat, "bytes:", csv.length);

    await INSERT.into(CsvFiles).entries({  
      chat_ID : chat,
      content : csv
    });

    return "ok";
  });

});