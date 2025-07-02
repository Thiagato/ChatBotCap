 using my.chat as chat from '../db/schema';


 service ChatService {
 
//  function callDeepSeek(question: String) returns String;
   
   entity Chats    as projection on chat.Chats;
   entity Messages as projection on chat.Messages;

  action startChat(title : String) returns Chats;
  action sendMessage(chat : Chats, question : String) returns Messages;

}