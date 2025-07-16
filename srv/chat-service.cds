 using my.chat as chat from '../db/schema';


 service ChatService @(requires: 'ChatUser') {
 
//  function callDeepSeek(question: String) returns String;
   
   entity Chats    as projection on chat.Chats;
   entity Messages as projection on chat.Messages;
   entity CsvFiles as projection on chat.CsvFiles;


  action startChat(title : String) returns Chats;
  action sendMessage(chat : Chats, question : String) returns Messages;
  action uploadCsv(chat : UUID, csv : LargeString) returns String;


}