cmake_minimum_required(VERSION 3.16)
project(cs2lan CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

include(FetchContent)
set(BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
FetchContent_Declare(raylib
  GIT_REPOSITORY https://github.com/raysan5/raylib.git
  GIT_TAG 5.5
  GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(raylib)

find_package(Threads REQUIRED)
add_executable(cs2lan main.cpp net.cpp server.cpp)
target_link_libraries(cs2lan PRIVATE raylib Threads::Threads)
if(WIN32)
  target_link_libraries(cs2lan PRIVATE ws2_32)
endif()

# copy maps/ and models/ next to the executable
add_custom_command(TARGET cs2lan POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy_directory ${CMAKE_SOURCE_DIR}/maps   $<TARGET_FILE_DIR:cs2lan>/maps
  COMMAND ${CMAKE_COMMAND} -E copy_directory ${CMAKE_SOURCE_DIR}/models $<TARGET_FILE_DIR:cs2lan>/models)
