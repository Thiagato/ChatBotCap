namespace my.chat;

using { cuid, managed } from '@sap/cds/common';


entity Users : cuid, managed {
    name  : String;
    email : String;
    // ... outros campos que você tenha ...
    // Esta associação é o "inverso" da relação, útil para navegar
    // de um usuário para todos os seus chats.
    chats : Association to many Chats on chats.user = $self;
}

entity Chats : cuid, managed {
    title       : String(255);
    lastMessage : LargeString;
  
    messages    : Composition of many Messages on messages.chat = $self;
    user  : Association to Users; 
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