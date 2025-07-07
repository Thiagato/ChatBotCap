namespace my.chat;

using { cuid, managed } from '@sap/cds/common';

entity Chats : cuid, managed {
    title       : String(255);
    lastMessage : LargeString;
  
    messages    : Composition of many Messages on messages.chat = $self;
}
entity Messages : cuid, managed {
    chat   : Association to Chats; 
    
    // muito mais limpa
    sender : String enum { 
        user; 
        bot; 
    };
    text   : LargeString;
}
entity CsvFiles : cuid, managed {
  chat_ID : UUID;
  content : LargeString;
}