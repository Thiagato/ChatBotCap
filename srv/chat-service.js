const cds = require('@sap/cds');
const OpenAI = require("openai");
const errorMsg = require("./utils/deepseekErros");

require('dotenv').config();

const openai = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY
});

module.exports = cds.service.impl(function (srv) {

  const MAX_CONTEXT = 10;                       // quantas msgs anteriores enviar

  const { Chats, Messages } = srv.entities;

  console.log("✅ CAP Service inicializado");

  srv.on('startChat', async req => {
    const { title } = req.data;
    const [chat] = await cds.run(INSERT.into(Chats).entries({ title }));
    return chat;
  });

  srv.on('sendMessage', async req => {
    //  Extrai parâmetros
    const chatGuid = typeof req.data.chat === 'string'
      ? req.data.chat
      : req.data.chat.ID;          // entidade = {ID: …}
    const question = req.data.question;

    // Grava pergunta do usuário (sincrono)                  
    await INSERT.into(Messages).entries({
      chat_ID: chatGuid,              // GUID puro
      sender: 'user',
      text: question
    });

    //DISPARA processamento assincrono (não await!)            
    (async () => {
      try {
        // busca últimas N*2 mensagens para contexto           
        const prev = await SELECT.from(Messages)
          .where({ chat_ID: chatGuid })
          .orderBy('createdAt desc')
          .limit(MAX_CONTEXT * 2);

        const contextMsgs = prev.reverse().map(m => ({
          role: m.sender === 'user' ? 'user' : 'assistant',
          content: m.text
        }));

        // monta payload e chama DeepSeek                      
        const { choices } = await openai.chat.completions.create({
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: 'Você é um assistente SAP CAP/BTP em pt-BR.'
            },
            ...contextMsgs,
            { role: 'user', content: question }
          ]
        });

        const answer = choices?.[0]?.message?.content ?? "❔";

        //grava resposta do bot                               
        await INSERT.into(Messages).entries({
          chat_ID: chatGuid,
          sender: 'bot',
          text: answer
        });

        // atualiza resumo no Chat  
        await UPDATE(Chats, { ID: chatGuid }).with({ lastMessage: answer });

        console.log("[DeepSeek] resposta gravada para chat", chatGuid);
      } catch (e) {
        console.error("[DeepSeek bg] erro:", e);

        // 1. captura status (OpenAI SDK devolve .status)
        const status = e?.status || e?.code || "DEFAULT";
        const friendly = errorMsg[status] || errorMsg.DEFAULT;

        // 2. grava mensagem de erro para o usuário
        await INSERT.into(Messages).entries({
          chat_ID: chatGuid,
          sender: "bot",
          text: friendly
        });

        // 3. registra no Chat o último erro
        await UPDATE(Chats, { ID: chatGuid })
          .with({ lastMessage: friendly });
      }
    })();   // ← dispara e esquece

    // Resposta imediata para o frontend                
    return { status: "queued" };      // front ativa polling e logo vê a resposta
  });
});