sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator"
], function (Controller, MessageToast, JSONModel, Filter, FilterOperator) {
    "use strict";

    return Controller.extend("chatbot.controller.viewChatBot", {

        /* ----------------- Propriedades internas ----------------- */
        _chatId: null,
        _oMsgModel: null,
        _pollTimer: null,
        _pollChatId: null,

        /* ======================  LIFECYCLE  ====================== */
        onInit: function () {
            console.log("[chatbot] onInit…");

            /* Modelo local */
            this._oMsgModel = new sap.ui.model.json.JSONModel({
                messages: [],
                typing: false
            });
            this.getView().setModel(this._oMsgModel, "local");

            /* Chamada assíncrona, mas sem ‘return’ para o UI5 */
            this._loadChatList()
                .catch(e => {
                    console.error("[chatbot] erro onInit:", e);
                    sap.m.MessageToast.show("Erro ao carregar lista de chats");
                });
        },

        /* ====================  CARGA INICIAL  ==================== */
        async _loadChatList() {
            const oModel = this._getODataModel();
            const oBinding = oModel.bindList("/Chats");
            const aChats = (await oBinding.requestContexts())
                .map(c => c.getObject());

            console.log(`[chatbot] ${aChats.length} chat(s) encontrados`);

            if (aChats.length) {
                this._chatId = aChats[0].ID;
                await this._loadHistory();

                /* destaca o primeiro item na master list */
                setTimeout(() => {
                    const oList = this.byId("chatMasterList");
                    const oItem = oList.getItems()[0];
                    if (oItem) { oList.setSelectedItem(oItem); }
                }, 0);
            }
        },

        _getODataModel() {
            return this.getOwnerComponent().getModel() ||
                this.getOwnerComponent().getModel("shop");
        },

        /* ================  HISTÓRICO DE MENSAGENS  ================ */
        async _loadHistory() {
            if (!this._chatId) { return; }

            const oModel = this._getODataModel();
            const oBinding = oModel.bindList("/Messages", null, [
                new sap.ui.model.Sorter("createdAt", false), // ASC
                new sap.ui.model.Sorter("sender", true)   // user antes do bot no mesmo ts
            ]);

            oBinding.filter(new Filter("chat_ID", FilterOperator.EQ, this._chatId));

            const aMsgs = (await oBinding.requestContexts()).map(ctx => {
                const m = ctx.getObject();
                return { sender: m.sender, text: m.text };
            });

            this._oMsgModel.setProperty("/messages", aMsgs);
            this._scrollToEnd();
        },

        _addMessageToChat(sender, text) {
            const msgs = this._oMsgModel.getProperty("/messages");
            msgs.push({ sender, text });
            this._oMsgModel.checkUpdate();
            this._scrollToEnd();
        },

        _scrollToEnd() {
            const oSC = this.byId("scrollContainer");
            if (!oSC) { return; }
            setTimeout(() => {
                const dom = oSC.getDomRef("scroll");
                if (dom) { oSC.scrollTo(0, dom.scrollHeight, 0); }
            }, 0);
        },

        /* ========================  UI ============================ */
        async onCreateChat() {
            try {
                const oModel = this._getODataModel();
                const oAction = oModel.bindContext("/startChat(...)");

                await oAction.execute();

                this._stopPolling();                // para qualquer timer antigo

                const oChat = await oAction.getBoundContext().requestObject();
                this._chatId = oChat.ID;

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
                this._stopPolling();
                this._chatId = sId;
                this._oMsgModel.setProperty("/messages", []);
                await this._loadHistory();
            }
        },

        /* -------------- Envio e polling da resposta -------------- */
        async onSend() {
            const oInput = this.byId("input");
            const sQuest = (oInput.getValue() || "").trim();
            if (!sQuest) { return; }

            if (!this._chatId) { await this.onCreateChat(); }

            /* (1) exibe pergunta do usuário */
            this._addMessageToChat("user", sQuest);
            oInput.setValue("");

            /* (2) liga spinner do bot */
            this._showTypingIndicator();

            try {
                const oModel = this._getODataModel();
                const oAction = oModel.bindContext("/sendMessage(...)");
                oAction.setParameter("chat", { ID: this._chatId });
                oAction.setParameter("question", sQuest);

                await oAction.execute();           // backend => “queued”
                oModel.refresh();                  // atualiza master
                this._startPolling(this._chatId);  // dispara loop de verificação

            } catch (e) {
                console.error("[chatbot] sendMessage falhou:", e);
                MessageToast.show("Erro: " + e.message);
                this._hideTypingIndicator();       // garante desligar spinner
            }
        },

        onInputChange(oEvt) {
            const oBtn = this.byId("btnSend");
            const sVal = oEvt.getParameter("value").trim();
            oBtn.setEnabled(!!sVal);
        },

        /* ------------------- Polling simples --------------------- */
        _startPolling(chatId) {
            if (this._pollTimer) { return; }

            this._pollChatId = chatId;
            const MAX_CHECKS = 30;
            let checks = 0;

            this._pollTimer = setInterval(async () => {

                if (this._pollChatId !== this._chatId) { return this._stopPolling(); }

                const lenBefore = this._oMsgModel.getProperty("/messages").length;
                await this._loadHistory();
                const lenAfter = this._oMsgModel.getProperty("/messages").length;

                if (lenAfter > lenBefore) {
                    this._stopPolling();             // resposta chegou
                } else if (++checks >= MAX_CHECKS) {
                    this._addMessageToChat("bot",
                        "⚠️ A IA está demorando mais que o normal para responder. Tente novamente mais tarde.");
                    this._stopPolling();
                }

            }, 2000);
        },

        _stopPolling() {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
            this._pollChatId = null;
            this._hideTypingIndicator();
        },

        /* ============  “bot digitando” helpers  ============ */
        _showTypingIndicator() {
            if (!this._oMsgModel.getProperty("/typing")) {
                this._oMsgModel.setProperty("/typing", true);
                this._scrollToEnd();
            }
        },

        _hideTypingIndicator() {
            if (this._oMsgModel.getProperty("/typing")) {
                this._oMsgModel.setProperty("/typing", false);
            }
        },

        /* ------------- Ajusta estilo de cada bolha --------------- */
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
