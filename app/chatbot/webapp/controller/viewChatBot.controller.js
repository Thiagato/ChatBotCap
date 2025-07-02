sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator"
], function (Controller, MessageToast, JSONModel, Filter, FilterOperator) {
    "use strict";

    return Controller.extend("chatbot.controller.viewChatBot", {

        _chatId: null,
        _oMsgModel: null,
        _pollTimer   : null,
        _pollChatId : null,

        //Lifecycle                                      
        onInit: function () {
            console.log("[chatbot] onInit…");

            /* modelo local p/ mensagens */
            this._oMsgModel = new JSONModel({ messages: [] });
            this.getView().setModel(this._oMsgModel, "local");

            /* bootstrap assíncrono sem retornar promise */
            (async () => {
                try {
                    await this._loadChatList();       // carrega /Chats
                } catch (e) {
                    console.error("[chatbot] erro onInit:", e);
                    MessageToast.show("Erro ao carregar lista de chats");
                }
            })();
        },

        async _loadChatList() {
            const oModel = this._getODataModel();
            const oBinding = oModel.bindList("/Chats");
            const aCtx = await oBinding.requestContexts();
            const aChats = aCtx.map(c => c.getObject());

            console.log(`[chatbot] ${aChats.length} chat(s) encontrados.`);

            if (aChats.length) {
                this._chatId = aChats[0].ID;
                await this._loadHistory();

                // Seleciona primeiro item visualmente
                setTimeout(() => {
                    const oList = this.byId("chatMasterList");
                    const oItem = oList.getItems()[0];
                    if (oItem) oList.setSelectedItem(oItem);
                }, 0);
            }
        },

        /* Helpers                                                 */
        _getODataModel() {
            return this.getOwnerComponent().getModel() ||
                this.getOwnerComponent().getModel("shop");
        },

        async _loadHistory() {
            console.log("[chatbot] _loadHistory – chat:", this._chatId);

            const oModel = this._getODataModel();
            const aSorters = [
                new sap.ui.model.Sorter("createdAt", false),   // ASC por data
                // empata por sender: user (u) > bot (b)  → descending faz user vir 1º ;;; como as mensagens do bot e do usuario são ao mesmo tempo ele buga a ordenação padrao
                new sap.ui.model.Sorter("sender", true)        // DESC alfabético
            ];

            const oBinding = oModel.bindList("/Messages", null, aSorters);
            oBinding.filter(new sap.ui.model.Filter(
                "chat_ID", sap.ui.model.FilterOperator.EQ, this._chatId
            ));

            const aCtx = await oBinding.requestContexts();
            const aMsgs = aCtx.map(ctx => {
                const m = ctx.getObject();
                return { sender: m.sender, text: m.text };
            });

            console.log(`[chatbot] histórico (${aMsgs.length}) mensagens ordenadas.`);
            this._oMsgModel.setProperty("/messages", aMsgs);
            this._scrollToEnd();
        }
        ,

        _addMessageToChat(sender, text) {
            const a = this._oMsgModel.getProperty("/messages");
            a.push({ sender, text });
            this._oMsgModel.checkUpdate();
            this._scrollToEnd();
        },

        _scrollToEnd() {
            const oSC = this.byId("scrollContainer");
            if (!oSC) return;
            setTimeout(() => {
                const dom = oSC.getDomRef("scroll");
                if (dom) oSC.scrollTo(0, dom.scrollHeight, 0);
            }, 0);
        },
        // Ações UI                                            
        async onCreateChat() {
            try {
                const oModel  = this._getODataModel();
                const oAction = oModel.bindContext("/startChat(...)");
        
                console.log("[chatbot] onCreateChat – startChat");
                await oAction.execute();
        
                this._stopPolling();                 // cancela polling antigo
        
                const oChat  = await oAction.getBoundContext().requestObject();
                this._chatId = oChat.ID;
                console.log("[chatbot] novo chat ID:", this._chatId);
        
                this._oMsgModel.setProperty("/messages", []);
                await this._loadHistory();
                oModel.refresh();
            } catch (e) {
                console.error("[chatbot] erro onCreateChat:", e);
                MessageToast.show("Erro ao criar chat");
            }
        },

        async onChatSelect(oEvt) {
            const sId = oEvt.getParameter("listItem")
                            .getBindingContext().getProperty("ID");
        
            if (sId !== this._chatId) {
                this._stopPolling();                 // parar timer do chat anterior
                this._chatId = sId;
                this._oMsgModel.setProperty("/messages", []);
                await this._loadHistory();
            }
        },

        /* Envio de mensagem – “fire-and-forget” + polling         */
        async onSend() {
            const oInput = this.byId("input");
            const sQuest = (oInput.getValue() || "").trim();
            if (!sQuest) { return; }
        
            if (!this._chatId) { await this.onCreateChat(); }
        
            console.log("[chatbot] Pergunta:", sQuest);
            this._addMessageToChat("user", sQuest);
            oInput.setValue("");
        
            try {
                const oModel  = this._getODataModel();
                const oAction = oModel.bindContext("/sendMessage(...)");
                oAction.setParameter("chat",     { ID : this._chatId });
                oAction.setParameter("question", sQuest);
        
                await oAction.execute();                        // queued
                console.log("[chatbot] mensagem enfileirada…");
        
                oModel.refresh();                               // atualiza master
                this._startPolling(this._chatId);   // <- passa chat atual
            } catch (e) {
                console.error("[chatbot] sendMessage falhou:", e);
                MessageToast.show("Erro: " + e.message);
            }
        },

        /* Polling simples: recarrega histórico a cada 2 s         */
        _startPolling(chatId) {
            if (this._pollTimer) { return; }         // já existe
        
            this._pollChatId = chatId;
            const MAX_CHECKS = 60; // lembrar q aq é 2x porq são 2 segundos
            let checks = 0;
        
            this._pollTimer = setInterval(async () => {
                // se usuário mudou de chat, aborta
                if (this._pollChatId !== this._chatId) {
                    return this._stopPolling();
                }
        
                const lenBefore = this._oMsgModel.getProperty("/messages").length;
                await this._loadHistory();           // carrega chatId ativo
                const lenAfter = this._oMsgModel.getProperty("/messages").length;
        
                if (lenAfter > lenBefore) {
                    console.log("[chatbot] resposta chegou – stop polling");
                    this._stopPolling();
                } else if (++checks >= MAX_CHECKS) {
                    console.warn("[chatbot] polling timeout – stop");
                    this._stopPolling();
                }
            }, 2000);
        },
        _stopPolling() {
            clearInterval(this._pollTimer);
            this._pollTimer  = null;
            this._pollChatId = null;
        },

        onChatUpdateFinished(oEvt) {
            oEvt.getSource().getItems().forEach(it => {
                const data = it.getBindingContext("local").getObject();
                const bubble = it.getContent()[0].getItems()[0];
                bubble.toggleStyleClass("chatUserMsg", data.sender === "user");
                bubble.toggleStyleClass("chatBotMsg", data.sender === "bot");
            });
        }
    });
});
