const cds = require('@sap/cds');
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
const errorMsg = require('./utils/deepseekErros');

module.exports = cds.service.impl(function (srv) {
  const MAX_CONTEXT = 10;
  const { Chats, Messages, CsvFiles } = srv.entities;
  const { uuid } = cds.utils;

  async function callLlmViaDestination(payload) {
    const response = await executeHttpRequest(
      { destinationName: 'DEEPSEEK_API' },
      {
        method: 'POST',
        url: '/chat/completions',
        data: payload,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data;
  }

  srv.on('startChat', async req => {
    const title = req.data.title || 'Novo Chat';
    const ID = uuid();

    const entry = {
      ID,
      title
    };

    console.log('[startChat] criando chat:', entry);

    await INSERT.into(Chats).entries(entry);

    const created = await SELECT.one.from(Chats).where({ ID });

    console.log('[startChat] chat criado:', created);

    return created;
  });

  srv.on('uploadCsv', async req => {
    const { chat, csv } = req.data;

    if (!chat) req.reject(400, 'chat obrigatório');
    if (!csv) req.reject(400, 'csv obrigatório');

    console.log('[uploadCsv] chat:', chat, 'bytes:', csv.length);

    await INSERT.into(CsvFiles).entries({
      chat_ID: chat,
      content: csv
    });

    return 'ok';
  });

  srv.on('sendMessage', async req => {
    const { chat, question } = req.data;

    if (!chat) req.reject(400, 'chat obrigatório');
    if (!question) req.reject(400, 'question obrigatória');

    await INSERT.into(Messages).entries({
      chat_ID: chat,
      sender: 'user',
      text: question
    });

    (async () => {
      try {
        const csvRow = await SELECT.one.from(CsvFiles)
          .where({ chat_ID: chat })
          .orderBy('createdAt desc');

        const csvText = csvRow?.content || '';

        const prev = await SELECT.from(Messages)
          .where({ chat_ID: chat })
          .orderBy('createdAt desc')
          .limit(MAX_CONTEXT * 2);

        const contextMsgs = prev.reverse().map(m => ({
          role: m.sender === 'user' ? 'user' : 'assistant',
          content: m.text
        }));

        const result = await callLlmViaDestination({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: 'Você é um assistente SAP em pt-BR com especialidade em BTP.' },
            ...contextMsgs,
            {
              role: 'user',
              content: csvText
                ? `Contexto CSV:\n${csvText}\n\nPergunta: ${question}`
                : question
            }
          ],
          max_tokens: 2048
        });

        const answer = result?.choices?.[0]?.message?.content ?? '❔';

        await INSERT.into(Messages).entries({
          chat_ID: chat,
          sender: 'bot',
          text: answer
        });

        await UPDATE(Chats).set({ lastMessage: answer }).where({ ID: chat });

        console.log('[sendMessage] resposta gravada para chat', chat);
      } catch (e) {
        console.error('[LLM] erro:', e);

        const friendly =
          errorMsg[e?.statusCode] ||
          errorMsg[e?.status] ||
          errorMsg.DEFAULT;

        await INSERT.into(Messages).entries({
          chat_ID: chat,
          sender: 'bot',
          text: friendly
        });

        await UPDATE(Chats).set({ lastMessage: friendly }).where({ ID: chat });
      }
    })();

    return { status: 'queued' };
  });
});