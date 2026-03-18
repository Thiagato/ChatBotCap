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
        _pollTimer: null,
        _pollChatId: null,
        _pendingCsv: null,

        onInit: function () {
            console.log("[chatbot] onInit iniciado");

            if (window.marked) {
                marked.setOptions({
                    highlight: function (code, lang) {
                        if (window.hljs && hljs.getLanguage(lang)) {
                            return hljs.highlight(code, { language: lang }).value;
                        } else if (window.hljs) {
                            return hljs.highlightAuto(code).value;
                        }
                        return code;
                    }
                });
            }

            this._oMsgModel = new sap.ui.model.json.JSONModel({
                messages: [],
                typing: false
            });
            this.getView().setModel(this._oMsgModel, "local");

            this._loadChatList().catch(e => {
                console.error("[chatbot] erro no onInit/_loadChatList:", e);
                sap.m.MessageToast.show("Erro ao carregar lista de chats");
            });
        },

        async _loadChatList() {
            const oModel = this._getODataModel();
            console.log("[chatbot] _loadChatList - model:", oModel);

            const oBinding = oModel.bindList("/Chats");
            const aChats = (await oBinding.requestContexts()).map(c => c.getObject());

            console.log("[chatbot] chats encontrados:", aChats);

            if (aChats.length) {
                this._chatId = aChats[0].ID;
                console.log("[chatbot] chat inicial selecionado:", this._chatId);

                await this._loadHistory();

                setTimeout(() => {
                    const oList = this.byId("chatMasterList");
                    const oItem = oList?.getItems?.()[0];
                    if (oItem) {
                        oList.setSelectedItem(oItem);
                    }
                }, 0);
            } else {
                console.log("[chatbot] nenhum chat encontrado na carga inicial");
            }
        },

        _getODataModel() {
            const oModel = this.getOwnerComponent().getModel() ||
                this.getOwnerComponent().getModel("shop");

            console.log("[chatbot] _getODataModel ->", oModel);
            return oModel;
        },

        async _loadHistory() {
            if (!this._chatId) {
                console.warn("[chatbot] _loadHistory chamado sem _chatId");
                return;
            }

            console.log("[chatbot] _loadHistory para chat:", this._chatId);

            const oModel = this._getODataModel();
            const oBinding = oModel.bindList("/Messages", null, [
                new sap.ui.model.Sorter("createdAt", false),
                new sap.ui.model.Sorter("sender", true)
            ]);

            oBinding.filter(new sap.ui.model.Filter(
                "chat_ID", sap.ui.model.FilterOperator.EQ, this._chatId
            ));

            const aMsgs = (await oBinding.requestContexts()).map(ctx => {
                const m = ctx.getObject();
                return {
                    sender: m.sender,
                    text: m.text,
                    html: m.sender === "bot" && window.marked ? marked.parse(m.text) : m.text
                };
            });

            console.log("[chatbot] mensagens carregadas:", aMsgs);

            this._oMsgModel.setProperty("/messages", aMsgs);
            this._scrollToEnd();
        },

        _addMessageToChat(sender, text) {
            console.log("[chatbot] adicionando mensagem local:", { sender, text });

            const msgs = this._oMsgModel.getProperty("/messages");
            msgs.push({ sender, text });
            this._oMsgModel.checkUpdate();
            this._scrollToEnd();
        },

        _scrollToEnd() {
            const oSC = this.byId("scrollContainer");
            if (!oSC) {
                console.warn("[chatbot] scrollContainer não encontrado");
                return;
            }

            setTimeout(() => {
                const dom = oSC.getDomRef("scroll");
                if (dom) {
                    oSC.scrollTo(0, dom.scrollHeight, 0);
                }
            }, 0);
        },

        async onCreateChat() {
            try {
                console.log("[chatbot] onCreateChat iniciado");

                const oModel = this._getODataModel();
                const oAction = oModel.bindContext("/startChat(...)");

                oAction.setParameter("title", "Novo Chat");
                console.log("[chatbot] executando startChat com title=Novo Chat");

                await oAction.execute();

                this._stopPolling();

                const oBoundContext = oAction.getBoundContext();
                console.log("[chatbot] boundContext startChat:", oBoundContext);

                const oChat = oBoundContext ? await oBoundContext.requestObject() : null;
                console.log("[chatbot] retorno startChat:", oChat);

                this._chatId = oChat?.ID || null;
                console.log("[chatbot] _chatId após startChat:", this._chatId);

                if (!this._chatId) {
                    throw new Error("startChat não retornou ID");
                }

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
                .getBindingContext()
                .getProperty("ID");

            console.log("[chatbot] onChatSelect ->", sId);

            if (sId !== this._chatId) {
                this._stopPolling();
                this._chatId = sId;
                this._oMsgModel.setProperty("/messages", []);
                await this._loadHistory();
            }
        },

        async onSend() {
            const oInput = this.byId("input");
            const sQuest = (oInput.getValue() || "").trim();

            console.log("[chatbot] onSend iniciado");
            console.log("[chatbot] pergunta:", sQuest);
            console.log("[chatbot] _chatId antes de tudo:", this._chatId);
            console.log("[chatbot] _pendingCsv existe?", !!this._pendingCsv);

            if (!sQuest) {
                console.warn("[chatbot] pergunta vazia, abortando");
                return;
            }

            if (!this._chatId) {
                console.log("[chatbot] sem chatId, criando chat...");
                await this.onCreateChat();
                console.log("[chatbot] _chatId após onCreateChat:", this._chatId);
            }

            if (!this._chatId) {
                console.error("[chatbot] _chatId continua vazio após onCreateChat");
                MessageToast.show("Não foi possível criar o chat");
                return;
            }

            if (this._pendingCsv) {
                try {
                    const oModel = this._getODataModel();
                    const oUpload = oModel.bindContext("/uploadCsv(...)");
                    oUpload.setParameter("chat", this._chatId);
                    oUpload.setParameter("csv", this._pendingCsv);

                    await oUpload.execute();

                    console.log("[chatbot] uploadCsv executado com sucesso");

                    this._pendingCsv = null;
                    sap.m.MessageToast.show("CSV enviado com sucesso!");
                } catch (e) {
                    console.error("[chatbot] erro uploadCsv:", e);
                    sap.m.MessageToast.show("Falha ao enviar CSV");
                    return;
                }
            }

            this._addMessageToChat("user", sQuest);
            oInput.setValue("");
            this._showTypingIndicator();

            try {
                const oModel = this._getODataModel();
                const oAction = oModel.bindContext("/sendMessage(...)");

                console.log("[chatbot] preparando sendMessage");
                console.log("[chatbot] parâmetro chat:", this._chatId, typeof this._chatId);
                console.log("[chatbot] parâmetro question:", sQuest);

                oAction.setParameter("chat", this._chatId);
                oAction.setParameter("question", sQuest);

                console.log("[chatbot] executando sendMessage...");
                await oAction.execute();

                console.log("[chatbot] sendMessage executado com sucesso");

                oModel.refresh();
                this._startPolling(this._chatId);

            } catch (e) {
                console.error("[chatbot] sendMessage falhou:", e);
                sap.m.MessageToast.show("Erro: " + e.message);
                this._hideTypingIndicator();
            }
        },

        onInputChange(oEvt) {
            const oBtn = this.byId("btnSend");
            const sVal = oEvt.getParameter("value").trim();
            oBtn.setEnabled(!!sVal);
        },

        onSelectCSV: async function (oEvt) {
            const file = oEvt.getParameter("files")[0];
            if (!file) {
                console.warn("[chatbot] nenhum arquivo selecionado");
                return;
            }

            console.log("[chatbot] arquivo CSV selecionado:", file.name, file.size);

            this._pendingCsv = await file.text();
            console.log("[chatbot] CSV carregado em memória, tamanho:", this._pendingCsv?.length);

            sap.m.MessageToast.show("CSV carregado. Será enviado junto com a próxima pergunta.");
        },

        _startPolling(chatId) {
            if (this._pollTimer) {
                console.log("[chatbot] polling já ativo, ignorando novo start");
                return;
            }

            console.log("[chatbot] iniciando polling para chat:", chatId);

            this._pollChatId = chatId;
            const MAX_CHECKS = 30;
            let checks = 0;

            this._pollTimer = setInterval(async () => {
                if (this._pollChatId !== this._chatId) {
                    console.warn("[chatbot] polling interrompido por troca de chat");
                    return this._stopPolling();
                }

                const lenBefore = this._oMsgModel.getProperty("/messages").length;
                await this._loadHistory();
                const lenAfter = this._oMsgModel.getProperty("/messages").length;

                console.log("[chatbot] polling check", {
                    lenBefore,
                    lenAfter,
                    checks
                });

                if (lenAfter > lenBefore) {
                    console.log("[chatbot] resposta detectada, encerrando polling");
                    this._stopPolling();
                } else if (++checks >= MAX_CHECKS) {
                    console.warn("[chatbot] timeout do polling");
                    this._addMessageToChat(
                        "bot",
                        "⚠️ A IA está demorando mais que o normal para responder. Tente novamente mais tarde."
                    );
                    this._stopPolling();
                }
            }, 2000);
        },

        _stopPolling() {
            console.log("[chatbot] parando polling");

            clearInterval(this._pollTimer);
            this._pollTimer = null;
            this._pollChatId = null;
            this._hideTypingIndicator();
        },

        _showTypingIndicator() {
            if (!this._oMsgModel.getProperty("/typing")) {
                console.log("[chatbot] typing ON");
                this._oMsgModel.setProperty("/typing", true);
                this._scrollToEnd();
            }
        },

        _hideTypingIndicator() {
            if (this._oMsgModel.getProperty("/typing")) {
                console.log("[chatbot] typing OFF");
                this._oMsgModel.setProperty("/typing", false);
            }
        },

        onChatUpdateFinished(oEvt) {
            oEvt.getSource().getItems().forEach(it => {
                const data = it.getBindingContext("local").getObject();
                const bubble = it.getContent()[0].getItems()[0];

                bubble.toggleStyleClass("chatUserMsg", data.sender === "user");
                bubble.toggleStyleClass("chatBotMsg", data.sender === "bot");
            });

            if (window.hljs) {
                jQuery.sap.delayedCall(0, this, function () {
                    hljs.highlightAll();
                });
            }
        }
    });
});